import { useState, useEffect, useRef } from 'react';

interface ConsoleMessage {
  id: string;
  timestamp: Date;
  type: string;
  message: string;
  data: any;
  level: 'info' | 'success' | 'warning' | 'error';
}

interface ComfyUIConsoleProps {
  comfyUrl: string;
  isVisible: boolean;
  onClose: () => void;
}

export default function ComfyUIConsole({ comfyUrl, isVisible, onClose }: ComfyUIConsoleProps) {
  const [messages, setMessages] = useState<ConsoleMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [queueRemaining, setQueueRemaining] = useState<number>(0);
  const [currentExecution, setCurrentExecution] = useState<string | null>(null);
  const [filteredCount, setFilteredCount] = useState<number>(0);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addMessage = (type: string, data: any, level: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const message: ConsoleMessage = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      type,
      message: formatMessage(type, data),
      data,
      level
    };
    
    setMessages(prev => [...prev.slice(-99), message]); // Keep last 100 messages
  };

  const formatMessage = (type: string, data: any): string => {
    switch (type) {
      case 'execution_start':
        return `🚀 Starting execution for prompt ${data.prompt_id?.slice(-8) || 'unknown'}`;
      
      case 'execution_cached':
        return `⚡ Cached nodes: ${data.nodes?.length || 0} (prompt ${data.prompt_id?.slice(-8) || 'unknown'})`;
      
      case 'executing':
        if (data.node === null) {
          return `✅ Execution completed for prompt ${data.prompt_id?.slice(-8) || 'unknown'}`;
        }
        return `🔄 Executing node: ${data.node}`;
      
      case 'executed':
        return `✨ Node ${data.node} completed with UI output`;
      
      case 'progress':
        const percent = data.max ? Math.round((data.value / data.max) * 100) : 0;
        return `📊 ${data.node}: ${data.value}/${data.max} (${percent}%)`;
      
      case 'status':
        return `📋 Queue status: ${data.exec_info?.queue_remaining || 0} jobs remaining`;
      
      case 'execution_interrupted':
        return `⚠️ Execution interrupted at node ${data.node_id} (${data.node_type})`;
      
      case 'execution_error':
        return `❌ Execution error in prompt ${data.prompt_id?.slice(-8) || 'unknown'}`;
      
      case 'execution_success':
        return `🎉 Execution successful for prompt ${data.prompt_id?.slice(-8) || 'unknown'}`;
      
      case 'crystools.monitor':
        return `🖥️ System monitor: ${JSON.stringify(data).slice(0, 100)}...`;
        
      default:
        return `📝 ${type}: ${JSON.stringify(data)}`;
    }
  };

  const getMessageLevel = (type: string): 'info' | 'success' | 'warning' | 'error' => {
    switch (type) {
      case 'execution_success':
      case 'executed':
        return 'success';
      case 'execution_error':
        return 'error';
      case 'execution_interrupted':
        return 'warning';
      default:
        return 'info';
    }
  };

  // Filter configuration - easy to modify
  const FILTER_RULES: {
    nodeNames: string[];
    nodeTypes: string[];
    messageTypes: string[];
    outputContent: string[];
    customFilters: Array<(message: any) => boolean>;
  } = {
    // Node name filters (case-insensitive)
    nodeNames: [
      'crystools.monitor',
      // 'some_noisy_node',
      // 'debug_node',
      // Add more node names to filter here
    ],
    
    // Node type filters (case-insensitive)
    nodeTypes: [
      'crystools',
      // 'SomeNoisyNodeType',
      // 'DebugNode',
      // Add more node types to filter here
    ],
    
    // Message type filters (exact match)
    messageTypes: [
      'crystools.monitor',
      // 'progress_state',
      // 'debug_message',
      // Add message types to filter here
    ],
    
    // Output content filters (case-insensitive, searches in JSON stringified output)
    outputContent: [
      'crystools',
      // 'debug_info',
      // 'verbose_output',
      // Add more output content to filter here
    ],
    
    // Custom filter functions for complex rules
    customFilters: [
      // Example: Filter out progress messages with value 0
      // (message) => message.type === 'progress' && message.data?.value === 0,
      
      // Example: Filter out messages from specific prompt IDs
      // (message) => message.data?.prompt_id === 'some_specific_id',
      
      // Example: Filter out very frequent progress updates (keep only every 10th)
      // (message) => message.type === 'progress' && message.data?.value % 10 !== 0,
      
      // Add custom filter functions here
    ]
  };

  const shouldFilterMessage = (message: any): boolean => {
    // Filter by message type (direct match for crystools.monitor)
    if (message.type && typeof message.type === 'string') {
      const messageType = message.type.toLowerCase();
      // Check exact message types
      if (FILTER_RULES.messageTypes.includes(message.type)) {
        return true;
      }
      // Check if message type contains any of the node names (for crystools.monitor)
      if (FILTER_RULES.nodeNames.some(filter => messageType.includes(filter.toLowerCase()))) {
        return true;
      }
      // Check if message type contains any of the node types
      if (FILTER_RULES.nodeTypes.some(filter => messageType.includes(filter.toLowerCase()))) {
        return true;
      }
    }
    
    // Filter by node names in data
    if (message.data?.node && typeof message.data.node === 'string') {
      const nodeName = message.data.node.toLowerCase();
      if (FILTER_RULES.nodeNames.some(filter => nodeName.includes(filter.toLowerCase()))) {
        return true;
      }
    }
    
    // Filter by node types in data
    if (message.data?.node_type && typeof message.data.node_type === 'string') {
      const nodeType = message.data.node_type.toLowerCase();
      if (FILTER_RULES.nodeTypes.some(filter => nodeType.includes(filter.toLowerCase()))) {
        return true;
      }
    }
    
    // Filter by output content
    if (message.type === 'executed' && message.data?.output) {
      const outputStr = JSON.stringify(message.data.output).toLowerCase();
      if (FILTER_RULES.outputContent.some(filter => outputStr.includes(filter.toLowerCase()))) {
        return true;
      }
    }
    
    // Apply custom filters
    for (const customFilter of FILTER_RULES.customFilters) {
      if (customFilter(message)) {
        return true;
      }
    }
    
    return false;
  };

  const connectWebSocket = () => {
    if (!comfyUrl || wsRef.current?.readyState === WebSocket.OPEN) return;
    
    try {
      // Convert HTTP URL to WebSocket URL with proper protocol
      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      const wsUrl = comfyUrl.replace(/^https?:\/\//, protocol) + '/ws';
      addMessage('connection', { url: wsUrl }, 'info');
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        setIsConnected(true);
        setFilteredCount(0); // Reset filter count on new connection
        addMessage('connection', { status: 'connected' }, 'success');
      };
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Filter out crystools.monitor messages
          if (shouldFilterMessage(message)) {
            setFilteredCount(prev => prev + 1);
            return;
          }
          
          const level = getMessageLevel(message.type);
          
          // Update state based on message type
          switch (message.type) {
            case 'status':
              setQueueRemaining(message.data?.exec_info?.queue_remaining || 0);
              break;
            case 'executing':
              setCurrentExecution(message.data?.node || null);
              break;
          }
          
          addMessage(message.type, message.data, level);
        } catch (error: any) {
          addMessage('parse_error', { error: error.message || error.toString() }, 'error');
        }
      };
      
      ws.onerror = (error) => {
        addMessage('connection', { status: 'error', error: error.toString() }, 'error');
      };
      
      ws.onclose = () => {
        setIsConnected(false);
        setCurrentExecution(null);
        addMessage('connection', { status: 'disconnected' }, 'warning');
        
        // Auto-reconnect after 3 seconds if console is still visible
        if (isVisible) {
          setTimeout(() => {
            if (isVisible && wsRef.current?.readyState !== WebSocket.OPEN) {
              connectWebSocket();
            }
          }, 3000);
        }
      };
      
    } catch (error: any) {
      addMessage('connection', { status: 'error', error: error.message || error.toString() }, 'error');
    }
  };

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const clearMessages = () => {
    setMessages([]);
    setFilteredCount(0);
  };

  useEffect(() => {
    if (isVisible && comfyUrl) {
      connectWebSocket();
    } else {
      disconnectWebSocket();
    }
    
    return () => {
      disconnectWebSocket();
    };
  }, [isVisible, comfyUrl]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
            <h2 className="text-lg font-semibold text-white">ComfyUI Console</h2>
            <span className="text-sm text-gray-400">
              {comfyUrl.replace(/^https?:\/\//, '')}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Status Info */}
            <div className="flex items-center gap-4 text-sm text-gray-400 mr-4">
              <span>Queue: {queueRemaining}</span>
              {currentExecution && (
                <span className="text-blue-400">Running: {currentExecution}</span>
              )}
            </div>
            
            {/* Controls */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                showFilters 
                  ? 'bg-blue-600 hover:bg-blue-500 text-white' 
                  : 'bg-gray-700 hover:bg-gray-600 text-white'
              }`}
              title="Show/hide filter settings"
            >
              Filters
            </button>
            <button
              onClick={clearMessages}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
            >
              Clear
            </button>
            <button
              onClick={isConnected ? disconnectWebSocket : connectWebSocket}
              className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                isConnected 
                  ? 'bg-red-600 hover:bg-red-500 text-white' 
                  : 'bg-green-600 hover:bg-green-500 text-white'
              }`}
            >
              {isConnected ? 'Disconnect' : 'Connect'}
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-700 text-gray-400 hover:text-white rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
        
        {/* Filter Settings Panel */}
        {showFilters && (
          <div className="border-b border-gray-700 p-4 bg-gray-800">
            <h3 className="text-sm font-semibold text-white mb-3">Active Filters</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {/* Node Names */}
              <div>
                <div className="text-gray-400 font-medium mb-1">Node Names:</div>
                <div className="space-y-1">
                  {FILTER_RULES.nodeNames.length > 0 ? (
                    FILTER_RULES.nodeNames.map((filter, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-400 rounded-full"></span>
                        <code className="text-red-300">{filter}</code>
                      </div>
                    ))
                  ) : (
                    <span className="text-gray-500">None</span>
                  )}
                </div>
              </div>
              
              {/* Node Types */}
              <div>
                <div className="text-gray-400 font-medium mb-1">Node Types:</div>
                <div className="space-y-1">
                  {FILTER_RULES.nodeTypes.length > 0 ? (
                    FILTER_RULES.nodeTypes.map((filter, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                        <code className="text-yellow-300">{filter}</code>
                      </div>
                    ))
                  ) : (
                    <span className="text-gray-500">None</span>
                  )}
                </div>
              </div>
              
              {/* Message Types */}
              <div>
                <div className="text-gray-400 font-medium mb-1">Message Types:</div>
                <div className="space-y-1">
                  {FILTER_RULES.messageTypes.length > 0 ? (
                    FILTER_RULES.messageTypes.map((filter, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                        <code className="text-blue-300">{filter}</code>
                      </div>
                    ))
                  ) : (
                    <span className="text-gray-500">None</span>
                  )}
                </div>
              </div>
              
              {/* Output Content */}
              <div>
                <div className="text-gray-400 font-medium mb-1">Output Content:</div>
                <div className="space-y-1">
                  {FILTER_RULES.outputContent.length > 0 ? (
                    FILTER_RULES.outputContent.map((filter, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                        <code className="text-green-300">{filter}</code>
                      </div>
                    ))
                  ) : (
                    <span className="text-gray-500">None</span>
                  )}
                </div>
              </div>
            </div>
            
            {/* Custom Filters Count */}
            {FILTER_RULES.customFilters.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-700">
                <span className="text-gray-400 text-xs">
                  {FILTER_RULES.customFilters.length} custom filter(s) active
                </span>
              </div>
            )}
            
            {/* Instructions */}
            <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500">
              💡 To modify filters, edit the <code>FILTER_RULES</code> object in ComfyUIConsole.tsx
            </div>
          </div>
        )}
        
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {isConnected ? 'Waiting for messages...' : 'Not connected'}
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className="flex items-start gap-3">
                <span className="text-gray-500 text-xs whitespace-nowrap mt-0.5">
                  {msg.timestamp.toLocaleTimeString()}
                </span>
                <span className={`text-xs font-semibold uppercase tracking-wider mt-0.5 ${
                  msg.level === 'error' ? 'text-red-400' :
                  msg.level === 'warning' ? 'text-yellow-400' :
                  msg.level === 'success' ? 'text-green-400' :
                  'text-blue-400'
                }`}>
                  {msg.type}
                </span>
                <span className={`flex-1 ${
                  msg.level === 'error' ? 'text-red-300' :
                  msg.level === 'warning' ? 'text-yellow-300' :
                  msg.level === 'success' ? 'text-green-300' :
                  'text-gray-300'
                }`}>
                  {msg.message}
                </span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        
        {/* Footer */}
        <div className="p-3 border-t border-gray-700 text-xs text-gray-500">
          <div className="flex items-center justify-between">
            <span>WebSocket: {isConnected ? 'Connected' : 'Disconnected'}</span>
            <div className="flex items-center gap-4">
              <span>{messages.length} messages</span>
              {filteredCount > 0 && (
                <span className="text-yellow-400">
                  {filteredCount} filtered
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}