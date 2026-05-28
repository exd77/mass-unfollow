// X Unfollower Classic — Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('X Unfollower Classic installed');
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SESSION') {
    chrome.storage.local.get(['authToken', 'ct0', 'userId'], (data) => {
      sendResponse(data);
    });
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'SAVE_SESSION') {
    chrome.storage.local.set(message.data, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
