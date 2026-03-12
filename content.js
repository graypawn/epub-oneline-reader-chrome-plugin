let epubLines = [];
let currentIndex = -1;
let currentFileName = "";
let isVisible = false;
let isTextHidden = false;
let chapterMarkers = [];

const STEALTH_URL = "https://developer.mozilla.org/ko/docs/Web/JavaScript/Reference/Global_Objects/Array/slice";
const STORAGE_KEY_STATE = "__epub_reader_state__";
const STORAGE_KEY_EPUB  = "__epub_reader_file__";

// ── 페이지 이동 전 상태 저장 ──────────────────────────────────────
window.addEventListener('beforeunload', () => {
  if (!isVisible && epubLines.length === 0) return;
  saveFullState();
});

// ── 메시지 수신 (툴바 버튼 클릭) ─────────────────────────────────
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "toggleReader") {
    const bar = document.getElementById('stealth-epub-reader-bar');
    if (bar) {
      isVisible = !isVisible;
      bar.style.display = isVisible ? 'flex' : 'none';
      saveFullState();
    } else {
      createReaderBar();
      isVisible = true;
      // 바를 새로 만든 직후 저장된 상태 복원 시도
      restoreFullState();
    }
  }
});

// ── 키보드 단축키 ──────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const bar = document.getElementById('stealth-epub-reader-bar');
  if (!bar || !isVisible) return;

  // 숨김 상태가 아닐 때는 좌우 화살표의 기본 스크롤 동작을 항상 차단
  if (!isTextHidden && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    e.stopPropagation();
  }

  if (e.code === "Numpad0") {
    isTextHidden = !isTextHidden;
    updateDisplay();
    return;
  }

  if (epubLines.length === 0) return;
  if (isTextHidden) return; // 숨김 ON 상태에서는 페이지 넘김 잠금

  // 챕터 셀렉트 포커스 시: 좌우는 페이지 넘김으로 가로채고, 상하는 기본 동작(챕터 변경) 유지
  const isChapterSelectFocused = e.target === document.getElementById('epub-chapter-select');
  if (isChapterSelectFocused && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    e.stopPropagation();
    e.target.blur(); // 좌우 화살표 사용 시 포커스 해제
  } else if (!isChapterSelectFocused) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  }

  if (e.key === "ArrowRight") {
    if (currentIndex < epubLines.length - 1) {
      currentIndex++;
      updateDisplay();
      saveProgress();
    }
  } else if (e.key === "ArrowLeft") {
    if (currentIndex > 0) {
      currentIndex--;
      updateDisplay();
      saveProgress();
    }
  }
});

// ── 유틸 ───────────────────────────────────────────────────────────
function splitLongLine(line, maxLength = 110) {
  const chunks = [];
  for (let i = 0; i < line.length; i += maxLength) {
    chunks.push(line.substring(i, i + maxLength));
  }
  return chunks;
}

// ArrayBuffer ↔ base64 변환 (EPUB 바이너리 저장용)
function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buffer;
}

// ── 상태 전체 저장 ─────────────────────────────────────────────────
function saveFullState() {
  const state = {
    isVisible,
    isTextHidden,
    currentFileName,
    currentIndex,
    epubLines,
    chapterMarkers,
  };
  chrome.storage.local.set({ [STORAGE_KEY_STATE]: state });
}

// ── 상태 전체 복원 ─────────────────────────────────────────────────
function restoreFullState() {
  chrome.storage.local.get([STORAGE_KEY_STATE], (result) => {
    const state = result[STORAGE_KEY_STATE];
    if (!state || !state.isVisible) return; // 이전에 열려있지 않았으면 복원 안 함

    currentFileName = state.currentFileName || "";
    currentIndex    = state.currentIndex ?? -1;
    isTextHidden    = state.isTextHidden  || false;
    chapterMarkers  = state.chapterMarkers || [];
    epubLines       = state.epubLines     || [];

    // 챕터 셀렉트 복원
    const chapterSelect = document.getElementById('epub-chapter-select');
    if (chapterSelect) {
      chapterSelect.innerHTML = '';
      chapterMarkers.forEach(ch => {
        const option = document.createElement('option');
        option.value   = ch.index;
        option.innerText = ch.title;
        chapterSelect.appendChild(option);
      });
    }

    isVisible = true;
    const bar = document.getElementById('stealth-epub-reader-bar');
    if (bar) bar.style.display = 'flex';

    updateDisplay();
  });
}

// ── 리더 바 생성 ───────────────────────────────────────────────────
function createReaderBar() {
  const readerBar = document.createElement('div');
  readerBar.id = 'stealth-epub-reader-bar';

  readerBar.style.cssText = `
    position: fixed !important;
    bottom: 0 !important;
    left: 0 !important;
    width: 100% !important;
    height: 30px !important;
    background-color: #ffffff !important;
    z-index: 9999999 !important;
    display: flex !important;
    align-items: center !important;
    border-top: 1px solid #ddd !important;
    box-sizing: border-box !important;
    user-select: none !important;
  `;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id   = 'epub-upload-hidden';
  fileInput.accept = '.epub';
  fileInput.style.display = 'none';

  const uploadLabel = document.createElement('label');
  uploadLabel.htmlFor   = 'epub-upload-hidden';
  uploadLabel.innerText = '+';
  uploadLabel.style.cssText = 'cursor: pointer !important; font-weight: bold !important; padding: 0 15px !important; font-size: 16px !important; color: #888 !important; border-right: 1px solid #eee !important; height: 100% !important; display: flex !important; align-items: center !important; flex-shrink: 0 !important;';

  const chapterSelect = document.createElement('select');
  chapterSelect.id = 'epub-chapter-select';
  chapterSelect.style.cssText = 'border: none !important; background: transparent !important; font-size: 11px !important; color: #888 !important; width: 60px !important; margin-left: 5px !important; cursor: pointer !important; outline: none !important; flex-shrink: 0 !important; appearance: none !important; text-align: center !important; font-family: monospace !important;';

  chapterSelect.onchange = (e) => {
    if (e.target.value !== "") {
      currentIndex = parseInt(e.target.value);
      updateDisplay();
      saveProgress();
    }
  };

  const textDisplay = document.createElement('div');
  textDisplay.id = 'epub-text-display';
  textDisplay.style.cssText = `
    flex-grow: 1 !important;
    cursor: pointer !important;
    padding: 0 20px !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    text-align: left !important;
    height: 100% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    color: #555555 !important;
    font-size: 12px !important;
    font-family: monospace, sans-serif !important;
  `;
  textDisplay.innerText = "Ready...";

  textDisplay.onclick = (e) => {
    if (epubLines.length === 0 || isTextHidden) return;
    const rect   = textDisplay.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    if (clickX > rect.width / 3) {
      if (currentIndex < epubLines.length - 1) currentIndex++;
    } else {
      if (currentIndex > 0) currentIndex--;
    }
    updateDisplay();
    saveProgress();
  };

  readerBar.append(fileInput, uploadLabel, chapterSelect, textDisplay);
  document.body.appendChild(readerBar);

  // ── 파일 선택 시 EPUB 파싱 + 바이너리 저장 ──────────────────────
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    currentFileName = file.name;
    textDisplay.innerText = "Loading...";
    chapterMarkers = [];
    chapterSelect.innerHTML = '';

    try {
      const arrayBuffer = await file.arrayBuffer();

      // EPUB 바이너리를 base64로 변환해 storage에 저장
      const base64 = bufferToBase64(arrayBuffer);
      chrome.storage.local.set({ [STORAGE_KEY_EPUB]: { name: file.name, data: base64 } });

      await parseAndLoadEpub(arrayBuffer, chapterSelect, textDisplay);
    } catch (err) {
      textDisplay.innerText = "Error: " + err.message;
    }
  };
}

// ── EPUB 파싱 (ArrayBuffer 받아서 처리) ───────────────────────────
async function parseAndLoadEpub(arrayBuffer, chapterSelectEl, textDisplayEl) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const containerText = await zip.file("META-INF/container.xml").async("string");
  const containerDoc  = new DOMParser().parseFromString(containerText, "text/xml");
  const opfPath       = containerDoc.querySelector("rootfile").getAttribute("full-path");
  const baseDir       = opfPath.substring(0, opfPath.lastIndexOf("/") + 1);

  const opfText = await zip.file(opfPath).async("string");
  const opfDoc  = new DOMParser().parseFromString(opfText, "text/xml");

  const manifestItems = {};
  opfDoc.querySelectorAll("manifest > item").forEach(item => {
    manifestItems[item.getAttribute("id")] = item.getAttribute("href");
  });

  const spineIds = Array.from(opfDoc.querySelectorAll("spine > itemref"))
                        .map(ref => ref.getAttribute("idref"));

  let tempLines = [];
  let actualChapterCount = 1;
  chapterMarkers = [];
  if (chapterSelectEl) chapterSelectEl.innerHTML = '';

  for (let i = 0; i < spineIds.length; i++) {
    const id       = spineIds[i];
    const href     = manifestItems[id];
    const filePath = baseDir + href;
    const fileData = zip.file(filePath);
    if (!fileData) continue;

    const htmlContent = await fileData.async("string");
    const doc         = new DOMParser().parseFromString(htmlContent, "text/html");

    const rawText      = doc.body.innerText || doc.body.textContent;
    const originalLines = rawText.split(/[.?!]\s|\n/)
                                 .map(line => line.replace(/\s+/g, ' ').trim())
                                 .filter(line => line.length > 1 && line !== "\u00A0");

    if (originalLines.length > 0) {
      const chTitle = `ID ${actualChapterCount}`;
      chapterMarkers.push({ title: chTitle, index: tempLines.length });

      if (chapterSelectEl) {
        const option     = document.createElement('option');
        option.value     = tempLines.length;
        option.innerText = chTitle;
        chapterSelectEl.appendChild(option);
      }

      originalLines.forEach(line => {
        if (line.length > 110) {
          tempLines = tempLines.concat(splitLongLine(line, 110));
        } else {
          tempLines.push(line);
        }
      });

      actualChapterCount++;
    }
  }

  epubLines     = tempLines;
  currentIndex  = -1;

  if (textDisplayEl) textDisplayEl.innerText = currentFileName;

  // 이어보기 확인
  chrome.storage.local.get([currentFileName], (result) => {
    if (result[currentFileName] !== undefined) {
      if (confirm("이어 보시겠습니까?")) {
        currentIndex = result[currentFileName];
        updateDisplay();
      }
    }
  });

  // 파싱 완료 후 전체 상태 저장
  saveFullState();
}

// ── 디스플레이 갱신 ────────────────────────────────────────────────
function updateDisplay() {
  const display       = document.getElementById('epub-text-display');
  const chapterSelect = document.getElementById('epub-chapter-select');

  if (display) {
    if (isTextHidden) {
      display.innerText = STEALTH_URL;
    } else if (epubLines[currentIndex]) {
      display.innerText = epubLines[currentIndex];
    } else if (currentIndex === -1 && currentFileName) {
      display.innerText = currentFileName;
    }

    if (chapterSelect && chapterMarkers.length > 0 && currentIndex >= 0) {
      let currentChIndex = 0;
      for (let i = 0; i < chapterMarkers.length; i++) {
        if (currentIndex >= chapterMarkers[i].index) {
          currentChIndex = chapterMarkers[i].index;
        } else {
          break;
        }
      }
      chapterSelect.value = currentChIndex;
    }
  }
}

// ── 진행 위치 저장 (파일명 기준) ──────────────────────────────────
function saveProgress() {
  if (currentFileName && currentIndex >= 0) {
    chrome.storage.local.set({ [currentFileName]: currentIndex });
  }
  saveFullState();
}

// ── 페이지 로드 시 자동 복원 ──────────────────────────────────────
(function autoRestore() {
  chrome.storage.local.get([STORAGE_KEY_STATE, STORAGE_KEY_EPUB], (result) => {
    const state    = result[STORAGE_KEY_STATE];
    const epubFile = result[STORAGE_KEY_EPUB];

    // 이전에 바가 열려있었던 경우에만 복원
    if (!state || !state.isVisible) return;

    // 바 생성
    createReaderBar();

    // 저장된 epubLines가 있으면 파싱 없이 바로 복원
    if (state.epubLines && state.epubLines.length > 0) {
      currentFileName = state.currentFileName || "";
      currentIndex    = state.currentIndex    ?? -1;
      isTextHidden    = state.isTextHidden     || false;
      chapterMarkers  = state.chapterMarkers   || [];
      epubLines       = state.epubLines;

      const chapterSelect = document.getElementById('epub-chapter-select');
      if (chapterSelect) {
        chapterSelect.innerHTML = '';
        chapterMarkers.forEach(ch => {
          const option     = document.createElement('option');
          option.value     = ch.index;
          option.innerText = ch.title;
          chapterSelect.appendChild(option);
        });
      }

      isVisible = true;
      const bar = document.getElementById('stealth-epub-reader-bar');
      if (bar) bar.style.display = 'flex';

      updateDisplay();
      return;
    }

    // epubLines가 없지만 EPUB 바이너리가 저장돼 있으면 재파싱
    if (epubFile && epubFile.data) {
      currentFileName = epubFile.name;
      const arrayBuffer = base64ToBuffer(epubFile.data);
      const chapterSelectEl = document.getElementById('epub-chapter-select');
      const textDisplayEl   = document.getElementById('epub-text-display');

      parseAndLoadEpub(arrayBuffer, chapterSelectEl, textDisplayEl).then(() => {
        // 저장된 읽기 위치로 복원
        if (state.currentIndex !== undefined && state.currentIndex >= 0) {
          currentIndex = state.currentIndex;
          updateDisplay();
        }
        isVisible = true;
        const bar = document.getElementById('stealth-epub-reader-bar');
        if (bar) bar.style.display = 'flex';
      });
    }
  });
})();
