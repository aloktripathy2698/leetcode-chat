import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Check, AlertCircle } from 'lucide-react';

const FALLBACK_API_KEY_STORAGE = 'leetcodeAssistant.apiKey';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

const getChromeStorageSync = () => {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
    return null;
  }
  return chrome.storage.sync;
};

const Settings: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ 
    type: null, 
    message: '' 
  });
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    loadApiKey();
  }, []);

  const loadApiKey = () => {
    const syncStorage = getChromeStorageSync();
    if (!syncStorage) {
      const fallbackValue = localStorage.getItem(FALLBACK_API_KEY_STORAGE) ?? '';
      setApiKey(fallbackValue);
      setStatus({ type: 'success', message: 'ℹ️ Using local storage while running outside Chrome.' });
      return;
    }

    syncStorage.get(['apiKey'], (result) => {
      const lastError = chrome.runtime?.lastError;
      if (lastError) {
        setStatus({ type: 'error', message: `❌ Unable to load key: ${lastError.message}` });
        return;
      }
      if (typeof result.apiKey === 'string') {
        setApiKey(result.apiKey);
      }
    });
  };

  const saveSettings = async () => {
    const trimmedKey = apiKey.trim();
    
    if (!trimmedKey) {
      setStatus({ type: 'error', message: '❌ Please enter an API key' });
      return;
    }
    
    if (!trimmedKey.startsWith('AIza')) {
      setStatus({ type: 'error', message: '❌ Invalid API key format. Gemini keys start with "AIza"' });
      return;
    }

    try {
      const syncStorage = getChromeStorageSync();
      if (syncStorage) {
        await new Promise<void>((resolve, reject) => {
          syncStorage.set({ apiKey: trimmedKey }, () => {
            const lastError = chrome.runtime?.lastError;
            if (lastError) {
              reject(new Error(lastError.message));
              return;
            }
            resolve();
          });
        });
      } else {
        localStorage.setItem(FALLBACK_API_KEY_STORAGE, trimmedKey);
      }

      setStatus({
        type: 'success',
        message: syncStorage
          ? '✅ Settings saved successfully!'
          : '✅ Saved locally. Install the extension to sync with Chrome.',
      });
      setTimeout(() => setStatus({ type: null, message: '' }), 3000);
    } catch (saveError) {
      const message = (saveError as Error).message || 'Unexpected error';
      setStatus({ type: 'error', message: `❌ Error saving settings: ${message}` });
    }
  };

  const testConnection = async () => {
    const trimmedKey = apiKey.trim();
    
    if (!trimmedKey) {
      setStatus({ type: 'error', message: '❌ Please enter an API key first' });
      return;
    }
    
    setIsTesting(true);
    setStatus({ type: 'success', message: '🔄 Testing connection...' });
    
    try {
      const url = `${GEMINI_ENDPOINT}?key=${trimmedKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: 'Hello, respond with just "Working!"' }]
          }]
        })
      });
      
      if (response.ok) {
        setStatus({ type: 'success', message: '✅ Connection successful! API key is valid.' });
      } else {
        const errorBody: unknown = await response.json();
        const errorMessage =
          typeof errorBody === 'object' &&
          errorBody !== null &&
          'error' in errorBody &&
          typeof (errorBody as { error?: { message?: string } }).error?.message === 'string'
            ? (errorBody as { error?: { message?: string } }).error?.message ?? 'Invalid API key'
            : 'Invalid API key';
        setStatus({ type: 'error', message: `❌ Connection failed: ${errorMessage}` });
      }
    } catch (connectionError) {
      setStatus({ type: 'error', message: `❌ Connection error: ${(connectionError as Error).message}` });
    } finally {
      setIsTesting(false);
      if (!getChromeStorageSync()) {
        localStorage.setItem(FALLBACK_API_KEY_STORAGE, trimmedKey);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 to-purple-900 py-10 px-5">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white py-10 px-8 text-center">
          <h1 className="text-3xl font-bold mb-2">⚙️ Settings</h1>
          <p className="text-orange-100">Configure your LeetCode Assistant</p>
        </div>

        {/* Content */}
        <div className="p-8">
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">🔑 API Configuration</h2>
            
            <div className="bg-blue-50 border-l-4 border-blue-500 rounded-lg p-4 mb-6">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">Get Your FREE Gemini API Key</h3>
              <ol className="space-y-2 text-sm text-blue-800">
                <li className="flex items-start">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold mr-2 flex-shrink-0 mt-0.5">1</span>
                  <span>Go to <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">Google AI Studio</a></span>
                </li>
                <li className="flex items-start">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold mr-2 flex-shrink-0 mt-0.5">2</span>
                  <span>Click "Create API Key"</span>
                </li>
                <li className="flex items-start">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold mr-2 flex-shrink-0 mt-0.5">3</span>
                  <span>Copy your API key</span>
                </li>
                <li className="flex items-start">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold mr-2 flex-shrink-0 mt-0.5">4</span>
                  <span>Paste it below and click Save</span>
                </li>
              </ol>
              <p className="mt-3 text-sm text-blue-800">
                <strong className="font-semibold">💡 It's completely FREE!</strong> 60 requests per minute.
              </p>
            </div>

            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-2">
              Gemini API Key
            </label>
            <div className="relative">
              <input
                id="apiKey"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Gemini API key (e.g., AIzaSy...)"
                className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:border-orange-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700"
              >
                {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  void saveSettings();
                }}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 px-6 rounded-lg transition-all hover:-translate-y-0.5 shadow-md hover:shadow-lg flex items-center justify-center gap-2"
              >
                <Check className="w-5 h-5" />
                Save Settings
              </button>
              <button
                type="button"
                onClick={() => {
                  void testConnection();
                }}
                disabled={isTesting}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isTesting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-5 h-5" />
                    Test Connection
                  </>
                )}
              </button>
            </div>

            {status.type && (
              <div className={`mt-4 p-4 rounded-lg ${
                status.type === 'success' 
                  ? 'bg-green-50 border border-green-200 text-green-800' 
                  : 'bg-red-50 border border-red-200 text-red-800'
              }`}>
                {status.message}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">ℹ️ About</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              This extension uses Google's Gemini AI to help you understand LeetCode problems. 
              Your API key is stored locally and never shared. All requests go directly to Google's servers.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 text-center py-5 text-sm text-gray-500">
          Made with ❤️ for better learning
        </div>
      </div>
    </div>
  );
};

export default Settings;
