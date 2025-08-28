import React, { useState } from "react";
import { Label, Field, Section } from "./components/UI";

interface Props {}

export default function ImageEdit({}: Props) {
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [result, setResult] = useState<string>("");
  const [editedImageUrl, setEditedImageUrl] = useState<string>("");
  const [originalImageUrl, setOriginalImageUrl] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Use environment variable for API key
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError("Please select a valid image file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setOriginalImageUrl(result);
      setError("");
    };
    reader.readAsDataURL(file);
  };

  const editImage = async () => {
    if (!userPrompt.trim()) {
      setError("Please enter edit instructions");
      return;
    }

    if (!originalImageUrl) {
      setError("Please upload an image to edit");
      return;
    }

    if (!apiKey) {
      setError("OpenRouter API key is required");
      return;
    }

    setIsGenerating(true);
    setError("");
    setResult("");
    setEditedImageUrl("");

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": window.location.origin,
          "X-Title": "VAPAI Studio",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          "model": "google/gemini-2.5-flash-image-preview:free",
          "modalities": ["image", "text"],
          "messages": [{
            "role": "user",
            "content": [
              {
                "type": "text",
                "text": `${userPrompt}. Output should be 16:9 widescreen composition.`
              },
              {
                "type": "image_url",
                "image_url": {
                  "url": originalImageUrl
                }
              }
            ]
          }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
      }

      const data = await response.json();
      const imageDataUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      
      if (imageDataUrl) {
        setEditedImageUrl(imageDataUrl);
        setResult("Image edited successfully!");
      } else {
        throw new Error("No edited image received");
      }

    } catch (err: any) {
      setError(err.message || "Failed to edit image");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      editImage();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl mx-auto space-y-8">
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent">
              Image Edit
            </h1>
            <div className="text-lg md:text-xl font-medium text-gray-700">
              <span className="bg-gradient-to-r from-purple-100 to-pink-100 px-4 py-2 rounded-full border border-purple-200/50">
                AI Image Generation
              </span>
            </div>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Upload an image and edit it using AI-powered image editing technology.
            </p>
          </div>

          <Section title="Edit Image">
            <div className="space-y-6">
              <Field>
                <Label>Upload Image to Edit</Label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 transition-all duration-200 bg-white/80 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                />
                {originalImageUrl && (
                  <div className="mt-4">
                    <img 
                      src={originalImageUrl} 
                      alt="Original image"
                      className="w-full max-w-md mx-auto rounded-xl shadow-lg border border-purple-200"
                    />
                    <p className="text-sm text-purple-600 text-center mt-2">Original image loaded</p>
                  </div>
                )}
              </Field>

              <Field>
                <Label>Edit Instructions</Label>
                <textarea
                  rows={4}
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80 resize-vertical"
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Describe how to edit the image... (e.g., 'Remove the background and add a sunset sky')"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Press Enter to edit, or Shift+Enter for new line
                </p>
              </Field>

              <div className="flex items-center gap-3">
                <button
                  onClick={editImage}
                  disabled={isGenerating || !userPrompt.trim() || !originalImageUrl}
                  className="px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg shadow-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Editing Image...
                    </>
                  ) : (
                    <>
                      <span>✨</span>
                      Edit Image
                    </>
                  )}
                </button>
              </div>

              {error && (
                <div className="p-4 rounded-2xl bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 text-red-800">
                    <span>❌</span>
                    <span className="font-medium">Error</span>
                  </div>
                  <p className="text-red-600 mt-1">{error}</p>
                </div>
              )}

              {editedImageUrl && (
                <div className="space-y-4">
                  <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2 text-purple-800">
                        <span>✨</span>
                        <span className="font-medium">Edited Image</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = editedImageUrl;
                            link.download = `edited-image-${Date.now()}.png`;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                          className="px-3 py-1 text-xs bg-green-200 hover:bg-green-300 text-green-800 rounded-lg transition-colors"
                        >
                          Download
                        </button>
                        <button
                          onClick={() => navigator.clipboard.writeText(editedImageUrl)}
                          className="px-3 py-1 text-xs bg-purple-200 hover:bg-purple-300 text-purple-800 rounded-lg transition-colors"
                        >
                          Copy URL
                        </button>
                      </div>
                    </div>
                    <div className="relative">
                      <img 
                        src={editedImageUrl} 
                        alt="Edited image"
                        className="w-full max-w-2xl mx-auto rounded-xl shadow-lg border border-purple-200"
                        onLoad={() => setResult("Image loaded successfully!")}
                        onError={() => setError("Failed to load edited image")}
                      />
                    </div>
                    {result && (
                      <div className="mt-3 text-sm text-purple-600 text-center">
                        {result}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Section>

          {!apiKey && (
            <Section title="API Configuration">
              <div className="p-4 rounded-2xl bg-yellow-50 border border-yellow-200">
                <div className="flex items-center gap-2 text-yellow-800 mb-2">
                  <span>⚠️</span>
                  <span className="font-medium">OpenRouter API Key Required</span>
                </div>
                <p className="text-yellow-700 text-sm">
                  To use image editing, you need to configure your OpenRouter API key. 
                  Get one at <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="underline">openrouter.ai</a>
                  <br /><br />
                  Set <code className="bg-yellow-200 px-1 rounded">VITE_OPENROUTER_API_KEY</code> environment variable in your .env file
                </p>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}