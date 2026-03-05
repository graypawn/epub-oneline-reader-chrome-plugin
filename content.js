let epubLines = []; 
let currentIndex = -1; 
let currentFileName = "";
let isVisible = false;
let isTextHidden = false; 
let chapterMarkers = []; 

const STEALTH_URL = "https://developer.mozilla.org/ko/docs/Web/JavaScript/Reference/Global_Objects/Array/slice";

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

window.addEventListener('keydown', (e) => {
  const bar = document.getElementById('stealth-epub-reader-bar');
  if (!bar || !isVisible) return;

  if (e.code === "Numpad0") {
    isTextHidden = !isTextHidden;
    updateDisplay();
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
  
  // 전체 바 스타일 설정 (!important 추가)
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
  fileInput.id = 'epub-upload-hidden';
  fileInput.accept = '.epub'; 
  fileInput.style.display = 'none';

  const uploadLabel = document.createElement('label');
  uploadLabel.htmlFor = 'epub-upload-hidden';
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
  // 텍스트 색상을 #555555(부드러운 회색)로 고정하고 !important 적용
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
    textDisplay.innerText = "Loading...";
    chapterMarkers = [];
    chapterSelect.innerHTML = '';
    
    try {
      const zip = await JSZip.loadAsync(file);
      const containerText = await zip.file("META-INF/container.xml").async("string");
      const containerDoc = new DOMParser().parseFromString(containerText, "text/xml");
      const rootFile = containerDoc.querySelector("rootfile");
      const opfPath = rootFile.getAttribute("full-path");
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
          chapterMarkers.push({ title: `ID ${actualChapterCount}`, index: tempLines.length });
          const option = document.createElement('option');
          option.value = tempLines.length;
          option.innerText = `ID ${actualChapterCount}`;
          chapterSelect.appendChild(option);
          
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
          if (confirm("이어 보시겠습니까?")) {
            currentIndex = result[currentFileName];
            updateDisplay();
          }
        }
      });
    } catch (err) {
      textDisplay.innerText = "Error";
    }
  };
}

function updateDisplay() {
  const display = document.getElementById('epub-text-display');
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

function saveProgress() {
  if (currentFileName && currentIndex >= 0) {
    chrome.storage.local.set({ [currentFileName]: currentIndex });
  }
}