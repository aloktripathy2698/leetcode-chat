const BUTTON_ID = 'leetcode-assistant-fab';
const STYLE_ID = 'leetcode-assistant-fab-style';

const createStyle = () => {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      position: fixed;
      right: 24px;
      bottom: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: radial-gradient(circle at 20% 20%, #f97316, #f97316 35%, #ec4899 100%);
      color: #fff;
      box-shadow: 0 12px 24px rgba(236, 72, 153, 0.35);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 700;
      z-index: 2147483646;
      transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
    }
    #${BUTTON_ID}:hover {
      transform: translateY(-2px) scale(1.05);
      box-shadow: 0 16px 32px rgba(236, 72, 153, 0.45);
    }
    #${BUTTON_ID}:active {
      transform: translateY(0) scale(0.98);
    }
    #${BUTTON_ID}-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      background: #22c55e;
      color: #fff;
      border-radius: 999px;
      font-size: 9px;
      font-weight: 600;
      padding: 2px 6px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      box-shadow: 0 4px 8px rgba(34, 197, 94, 0.4);
    }
    #${BUTTON_ID}-tooltip {
      position: fixed;
      right: 84px;
      bottom: 36px;
      background: rgba(15, 23, 42, 0.92);
      color: #e2e8f0;
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      box-shadow: 0 8px 16px rgba(15, 23, 42, 0.35);
      opacity: 0;
      transform: translateY(6px);
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
      z-index: 2147483645;
    }
    #${BUTTON_ID}:hover + #${BUTTON_ID}-tooltip {
      opacity: 1;
      transform: translateY(0);
    }
    @media (max-width: 768px) {
      #${BUTTON_ID} {
        right: 18px;
        bottom: 18px;
        width: 52px;
        height: 52px;
      }
      #${BUTTON_ID}-tooltip {
        display: none;
      }
    }
  `;

  document.head.appendChild(style);
};

const createButton = () => {
  if (document.getElementById(BUTTON_ID)) {
    return;
  }

  createStyle();

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.title = 'Open LeetCode Assistant';
  button.innerHTML = 'LC';

  const badge = document.createElement('span');
  badge.id = `${BUTTON_ID}-badge`;
  badge.textContent = 'AI';
  button.appendChild(badge);

  const tooltip = document.createElement('div');
  tooltip.id = `${BUTTON_ID}-tooltip`;
  tooltip.textContent = 'LeetCode Assistant';

  button.addEventListener('click', () => {
    const openFallback = () => {
      const extensionUrl =
        typeof chrome !== 'undefined' && chrome.runtime?.getURL
          ? chrome.runtime.getURL('sidepanel.html')
          : 'sidepanel.html';
      window.open(extensionUrl, '_blank', 'noopener');
    };

    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      openFallback();
      return;
    }

    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }, (response?: { success?: boolean }) => {
      const lastError = chrome.runtime?.lastError;
      if (lastError || response?.success === false) {
        openFallback();
      }
    });
  });

  const mount = () => {
    document.body.appendChild(button);
    document.body.appendChild(tooltip);
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
};

const ensureButton = () => {
  createButton();

  const observer = new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID)) {
      createButton();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureButton, { once: true });
} else {
  ensureButton();
}
