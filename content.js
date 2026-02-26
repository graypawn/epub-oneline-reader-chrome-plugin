let epubLines = []; 
let currentIndex = -1; 
let currentFileName = "";
let isVisible = false;
let chapterMarkers = []; 

// 메시지 수신 (토글)
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "toggleReader") {
    const bar = document.getElementById('stealth-epub-reader-bar');
    if (bar) {
      isVisible = !isVisible;
      bar.style.display = isVisible ? 'flex' : 'none';
    } else {
      createReaderBar();
      isVisible = true;
    }
  }
});

// 키보드 제어 (좌/우 방향키: 이동, 키패드 0: 숨기기)
window.addEventListener('keydown', (e) => {
  const bar = document.getElementById('stealth-epub-reader-bar');
  if (!bar || !isVisible) return;

  if (e.code === "Numpad0") {
    bar.style.display = 'none';
    isVisible = false;
    return;
  }

  if (epubLines.length === 0) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

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

// 긴 문장을 110자 단위로 자르는 함수
function splitLongLine(line, maxLength = 110) {
  const chunks = [];
  for (let i = 0; i < line.length; i += maxLength) {
    chunks.push(line.substring(i, i + maxLength));
  }
  return chunks;
}

function createReaderBar() {
  const readerBar = document.createElement('div');
  readerBar.id = 'stealth-epub-reader-bar';
  
  Object.assign(readerBar.style, {
    position: 'fixed', bottom: '0', left: '0', width: '100%', height: '30px',
    backgroundColor: '#ffffff', color: '#000000', fontSize: '13px', zIndex: '9999999',
    display: 'flex', alignItems: 'center', borderTop: '1px solid #ddd',
    boxSizing: 'border-box', fontFamily: 'sans-serif', userSelect: 'none'
  });

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'epub-upload-hidden';
  fileInput.accept = '.epub'; 
  fileInput.style.display = 'none';

  const uploadLabel = document.createElement('label');
  uploadLabel.htmlFor = 'epub-upload-hidden';
  uploadLabel.innerText = '+';
  uploadLabel.style.cssText = 'cursor: pointer; font-weight: bold; padding: 0 15px; font-size: 18px; color: #555; border-right: 1px solid #eee; height: 100%; display: flex; align-items: center; flex-shrink: 0;';

  const chapterSelect = document.createElement('select');
  chapterSelect.id = 'epub-chapter-select';
  chapterSelect.style.cssText = 'border: none; background: transparent; font-size: 11px; color: #888; width: 55px; margin-left: 5px; cursor: pointer; outline: none; flex-shrink: 0; appearance: none; text-align: center;';
  
  chapterSelect.onchange = (e) => {
    if (e.target.value !== "") {
      currentIndex = parseInt(e.target.value);
      updateDisplay();
      saveProgress();
    }
  };

  const textDisplay = document.createElement('div');
  textDisplay.id = 'epub-text-display';
  textDisplay.style.cssText = 'flex-grow: 1; cursor: pointer; padding: 0 20px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: left; height: 100%; display: flex; align-items: center; justify-content: flex-start;';
  textDisplay.innerText = "파일을 선택해 주세요.";

  textDisplay.onclick = (e) => {
    if (epubLines.length === 0) return;
    const rect = textDisplay.getBoundingClientRect();
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

  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    currentFileName = file.name;
    textDisplay.innerText = "로딩 중...";
    chapterMarkers = [];
    chapterSelect.innerHTML = '';
    
    try {
      const zip = await JSZip.loadAsync(file);
      const containerText = await zip.file("META-INF/container.xml").async("string");
      const containerDoc = new DOMParser().parseFromString(containerText, "text/xml");
      const opfPath = containerDoc.querySelector("rootfile").getAttribute("full-path");
      const baseDir = opfPath.substring(0, opfPath.lastIndexOf("/") + 1);

      const opfText = await zip.file(opfPath).async("string");
      const opfDoc = new DOMParser().parseFromString(opfText, "text/xml");
      
      const manifestItems = {};
      opfDoc.querySelectorAll("manifest > item").forEach(item => {
        manifestItems[item.getAttribute("id")] = item.getAttribute("href");
      });

      const spineIds = Array.from(opfDoc.querySelectorAll("spine > itemref"))
                            .map(ref => ref.getAttribute("idref"));

      let tempLines = [];
      let actualChapterCount = 1;

      for (let i = 0; i < spineIds.length; i++) {
        const id = spineIds[i];
        const href = manifestItems[id];
        const filePath = baseDir + href;
        const fileData = zip.file(filePath);
        if(!fileData) continue;

        const htmlContent = await fileData.async("string");
        const doc = new DOMParser().parseFromString(htmlContent, "text/html");
        
        const rawText = (doc.body.innerText || doc.body.textContent);
        const originalLines = rawText.split(/[.?!]\s|\n/)
                                     .map(line => line.replace(/\s+/g, ' ').trim())
                                     .filter(line => line.length > 1 && line !== "\u00A0");

        if (originalLines.length > 0) {
          chapterMarkers.push({ title: `Ch ${actualChapterCount}`, index: tempLines.length });
          const option = document.createElement('option');
          option.value = tempLines.length;
          option.innerText = `Ch ${actualChapterCount}`;
          chapterSelect.appendChild(option);
          
          // 각 문장을 110자 단위로 체크하여 필요시 분할
          originalLines.forEach(line => {
            if (line.length > 110) {
              const slicedChunks = splitLongLine(line, 110);
              tempLines = tempLines.concat(slicedChunks);
            } else {
              tempLines.push(line);
            }
          });
          
          actualChapterCount++;
        }
      }

      epubLines = tempLines;
      currentIndex = -1;
      textDisplay.innerText = currentFileName;

      chrome.storage.local.get([currentFileName], (result) => {
        if (result[currentFileName] !== undefined) {
          if (confirm("이전에 읽던 위치가 있습니다. 이어 보시겠습니까?")) {
            currentIndex = result[currentFileName];
            updateDisplay();
          }
        }
      });
    } catch (err) {
      textDisplay.innerText = "파싱 실패";
      console.error(err);
    }
  };
}

function updateDisplay() {
  const display = document.getElementById('epub-text-display');
  const chapterSelect = document.getElementById('epub-chapter-select');

  if (display && epubLines[currentIndex]) {
    display.innerText = epubLines[currentIndex];
    
    if (chapterSelect && chapterMarkers.length > 0) {
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

function saveProgress() {
  if (currentFileName && currentIndex >= 0) {
    chrome.storage.local.set({ [currentFileName]: currentIndex });
  }
}