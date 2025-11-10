import { useState, useEffect, useRef, useCallback } from 'react';

export interface ComfyUIProgress {
  completed_nodes: number;
  total_nodes: number;
  current_node?: string;
  queue_remaining: number;
  is_connected: boolean;
  detailed_progress?: {
    total_progress: number;
    max_progress: number;
    progress_percentage: number;
  };
  workflow_info?: {
    workflow_type: string;
    expected_total_nodes: number;
  };
}

interface ProgressMessage {
  type: string;
  data: any;
}

// Workflow node counts based on our analysis (currently unused but kept for future reference)
// const WORKFLOW_NODE_COUNTS = {
//   'MultiTalkOnePerson': 22,
//   'MultiTalkMultiplePeople': 30,
//   'VideoLipsync': 27,
//   'InfiniteTalkOnePerson': 22, // Assuming similar to MultiTalkOnePerson
//   'WANI2V': 20, // Estimated
//   'joycaption': 15 // Estimated
// };

// Function to determine workflow type and expected node count
function getWorkflowInfo(_promptId: string, activeNodes: string[]): { workflow_type: string; expected_total_nodes: number } {
  // For now, we'll use a simple heuristic based on the number of active nodes
  // In a real implementation, you might want to pass the workflow type from the job creation
  
  // If we have active nodes, we can make educated guesses
  if (activeNodes.length > 0) {
    // MultiTalk workflows typically have more nodes
    if (activeNodes.length >= 20) {
      return { workflow_type: 'MultiTalkMultiplePeople', expected_total_nodes: 30 };
    } else if (activeNodes.length >= 15) {
      return { workflow_type: 'MultiTalkOnePerson', expected_total_nodes: 22 };
    } else if (activeNodes.length >= 10) {
      return { workflow_type: 'VideoLipsync', expected_total_nodes: 27 };
    }
  }
  
  // Default fallback
  return { workflow_type: 'MultiTalkOnePerson', expected_total_nodes: 22 };
}

export function useComfyUIProgress(comfyUrl: string, enabled: boolean = true) {
  const [progress, setProgress] = useState<ComfyUIProgress>({
    completed_nodes: 0,
    total_nodes: 0,
    current_node: undefined,
    queue_remaining: 0,
    is_connected: false
  });
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connectWebSocket = useCallback(() => {
    if (!comfyUrl || !enabled || wsRef.current?.readyState === WebSocket.OPEN) return;
    
    try {
      // Convert HTTP URL to WebSocket URL with proper protocol
      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      const wsUrl = comfyUrl.replace(/^https?:\/\//, protocol) + '/ws';
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        setProgress(prev => ({ ...prev, is_connected: true }));
        console.log('🔌 ComfyUI WebSocket connected for progress tracking');
      };
      
      ws.onmessage = (event) => {
        try {
          const data = event.data;
          
          // Handle blob data
          if (data instanceof Blob) {
            console.log('Received blob data, converting to text...');
            data.text().then(text => {
              try {
                // Check if the text looks like JSON (starts with { or [)
                if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
                  const message: ProgressMessage = JSON.parse(text);
                  processMessage(message);
                } else {
                  console.log('Blob data is not JSON, ignoring:', text.substring(0, 50));
                }
              } catch {
                console.log('Blob data parsing failed, ignoring:', text.substring(0, 50));
              }
            });
            return;
          }
          
          // Handle string data
          if (typeof data === 'string') {
            const message: ProgressMessage = JSON.parse(data);
            processMessage(message);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      const processMessage = (message: ProgressMessage) => {
        // Filter out crystools.monitor messages (same as in ComfyUIConsole)
        if (message.type === 'crystools.monitor') {
          return;
        }
        
        // Update progress based on message type
        switch (message.type) {
          case 'status':
            setProgress(prev => ({
              ...prev,
              queue_remaining: message.data?.exec_info?.queue_remaining || 0
            }));
            break;
            
          case 'executing':
            if (message.data?.node) {
              setProgress(prev => ({
                ...prev,
                current_node: message.data.node,
                completed_nodes: prev.completed_nodes + 1
              }));
            }
            break;
            
          case 'execution_start':
            // Reset progress when new execution starts
            setProgress(prev => ({
              ...prev,
              completed_nodes: 0,
              total_nodes: message.data?.max_nodes || 0,
              current_node: undefined
            }));
            break;
            
          case 'progress_state':
            // Handle progress_state messages with detailed node information
            if (message.data?.nodes) {
              const nodes = message.data.nodes;
              const nodeIds = Object.keys(nodes);
              const completedNodes = nodeIds.filter(id => nodes[id].state === 'finished').length;
              const runningNodes = nodeIds.filter(id => nodes[id].state === 'running');
              const currentRunningNode = runningNodes.length > 0 ? nodes[runningNodes[0]] : null;
              
              // Get workflow info to determine expected total nodes
              const workflowInfo = getWorkflowInfo(message.data.prompt_id || '', nodeIds);
              
              // Calculate total progress based on individual node progress
              let totalProgress = 0;
              let maxProgress = 0;
              
              nodeIds.forEach(id => {
                const node = nodes[id];
                if (node.value !== undefined && node.max !== undefined) {
                  totalProgress += node.value;
                  maxProgress += node.max;
                }
              });
              
              // Calculate overall progress percentage
              // We use the expected total nodes, not just the active nodes
              const overallProgressPercentage = workflowInfo.expected_total_nodes > 0 ? 
                Math.round((completedNodes / workflowInfo.expected_total_nodes) * 100) : 0;
              
              setProgress(prev => ({
                ...prev,
                completed_nodes: completedNodes,
                total_nodes: workflowInfo.expected_total_nodes, // Use expected total, not active nodes
                current_node: currentRunningNode ? `Node ${currentRunningNode.node_id}` : undefined,
                workflow_info: workflowInfo,
                // Add detailed progress info
                detailed_progress: {
                  total_progress: totalProgress,
                  max_progress: maxProgress,
                  progress_percentage: overallProgressPercentage // Use overall progress, not just active nodes
                }
              }));
            }
            break;
            
          case 'execution_success':
          case 'execution_error':
          case 'execution_interrupted':
            // Keep progress but mark as completed
            setProgress(prev => ({
              ...prev,
              current_node: undefined
            }));
            break;
        }
      };
      
      ws.onerror = (error) => {
        console.error('ComfyUI WebSocket error:', error);
        setProgress(prev => ({ ...prev, is_connected: false }));
      };
      
      ws.onclose = () => {
        setProgress(prev => ({ ...prev, is_connected: false }));
        console.log('🔌 ComfyUI WebSocket disconnected');
        
        // Auto-reconnect after 3 seconds
        if (enabled) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, 3000);
        }
      };
      
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [comfyUrl, enabled]);

  const disconnectWebSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setProgress(prev => ({ ...prev, is_connected: false }));
  }, []);

  useEffect(() => {
    if (enabled && comfyUrl) {
      connectWebSocket();
    } else {
      disconnectWebSocket();
    }
    
    return () => {
      disconnectWebSocket();
    };
  }, [enabled, comfyUrl, connectWebSocket, disconnectWebSocket]);

  return {
    progress,
    connect: connectWebSocket,
    disconnect: disconnectWebSocket
  };
}
