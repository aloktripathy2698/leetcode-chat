// Content script to extract LeetCode problem information

interface ProblemInfo {
  title: string;
  difficulty: string;
  description: string;
  examples: string[];
  constraints: string;
  url: string;
  problemNumber: string;
  timestamp: number;
}

function extractProblemInfo(): ProblemInfo | null {
  try {
    // Title
    const titleElement = document.querySelector('[data-cy="question-title"]') || 
                        document.querySelector('.text-title-large');
    const title = titleElement?.textContent?.trim() || 'Unknown Problem';
    
    // Difficulty
    const difficultyElement = document.querySelector('[diff]') || 
                             document.querySelector('.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard');
    const difficulty = difficultyElement?.textContent?.trim() || 'Unknown';
    
    // Description
    const descriptionElement = document.querySelector('[class*="elfjS"]') || 
                               document.querySelector('.content__u3I1');
    const description = descriptionElement?.textContent?.trim() || '';
    
    // Examples
    const examples: string[] = [];
    const exampleElements = document.querySelectorAll('pre');
    exampleElements.forEach((el, idx) => {
      if (idx < 3) {
        examples.push(el.textContent?.trim() || '');
      }
    });
    
    // Constraints
    const constraintsMatch = description.match(/Constraints:([\s\S]*?)(?=Example|Follow-up|$)/);
    const constraints = constraintsMatch?.[1]?.trim() || '';
    
    // URL and problem number
    const url = window.location.href;
    const problemNumber = url.match(/\/problems\/([^\/]+)/)?.[1] || '';
    
    return {
      title,
      difficulty,
      description,
      examples,
      constraints,
      url,
      problemNumber,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Error extracting problem info:', error);
    return null;
  }
}

async function saveProblemInfo(): Promise<void> {
  const problemInfo = extractProblemInfo();
  
  if (problemInfo) {
    await chrome.storage.local.set({ currentProblem: problemInfo });
    console.log('Problem info saved:', problemInfo.title);
    
    chrome.runtime.sendMessage({
      action: 'problemDetected',
      problem: problemInfo
    });
  }
}

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getProblemInfo') {
    const problemInfo = extractProblemInfo();
    sendResponse({ problem: problemInfo });
  }
  return true;
});

// Detect URL changes
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (url.includes('/problems/')) {
      setTimeout(saveProblemInfo, 1000);
    }
  }
}).observe(document, { subtree: true, childList: true });

// Initial extraction
if (window.location.href.includes('/problems/')) {
  setTimeout(saveProblemInfo, 1000);
}