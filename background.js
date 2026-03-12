const STORAGE_KEY_STATE = "__epub_reader_state__";
const STORAGE_KEY_EPUB  = "__epub_reader_file__";
const STORAGE_KEY_NAV   = "__epub_reader_navigating__";

// 브라우저 시작 시 바 상태 초기화
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.remove([STORAGE_KEY_STATE, STORAGE_KEY_EPUB, STORAGE_KEY_NAV]);
});

// content script로부터 "화면 이동 중" 메시지 수신 → 탭 ID와 함께 플래그 저장
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action === "setNavigating") {
    // 탭 ID를 키로 저장해서 해당 탭의 이동임을 표시
    chrome.storage.local.set({ [STORAGE_KEY_NAV]: sender.tab.id });
  }

  if (request.action === "toggleReader") {
    // toggleReader는 action.onClicked에서 처리하므로 여기선 무시
  }
});

// 탭이 닫힐 때 → 해당 탭의 플래그였다면 삭제
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(STORAGE_KEY_NAV, (result) => {
    if (result[STORAGE_KEY_NAV] === tabId) {
      chrome.storage.local.remove([STORAGE_KEY_NAV, STORAGE_KEY_STATE, STORAGE_KEY_EPUB]);
    }
  });
});

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "toggleReader" });
});
