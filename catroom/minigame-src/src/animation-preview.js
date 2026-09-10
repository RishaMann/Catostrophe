const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const elements = {
  canvas: document.querySelector('#preview-canvas'),
  stage: document.querySelector('#stage'),
  empty: document.querySelector('#empty-state'),
  framesList: document.querySelector('#frames-list'),
  framesInput: document.querySelector('#frames-input'),
  sheetInput: document.querySelector('#sheet-input'),
  dropZone: document.querySelector('#drop-zone'),
  sheetButton: document.querySelector('#sheet-button'),
  sheetWidth: document.querySelector('#sheet-width'),
  sheetHeight: document.querySelector('#sheet-height'),
  clearButton: document.querySelector('#clear-button'),
  sortButton: document.querySelector('#sort-button'),
  playButton: document.querySelector('#play-button'),
  previousButton: document.querySelector('#previous-button'),
  nextButton: document.querySelector('#next-button'),
  fpsInput: document.querySelector('#fps-input'),
  fpsOutput: document.querySelector('#fps-output'),
  zoomInput: document.querySelector('#zoom-input'),
  zoomOutput: document.querySelector('#zoom-output'),
  gameAlignmentInput: document.querySelector('#game-alignment-input'),
  pingPongInput: document.querySelector('#ping-pong-input'),
  flipInput: document.querySelector('#flip-input'),
  title: document.querySelector('#animation-title'),
  stats: document.querySelector('#frame-stats'),
  counter: document.querySelector('#frame-counter')
};

const context = elements.canvas.getContext('2d');
let frames = [];
let currentIndex = 0;
let playing = false;
let direction = 1;
let lastFrameAt = 0;
let animationRequest = 0;
let draggedId = null;
let objectUrls = [];
let alignmentReference = null;

// Повторяет логику AssetGeometry.autoCat() из основной игры: у всей
// последовательности одна медианная точка опоры, а высота непрозрачного
// контента каждого кадра приводится к общей медиане.
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2
    ? sorted[Math.floor(middle)]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function alphaBounds(frame) {
  const canvas = document.createElement('canvas');
  canvas.width = frame.sw;
  canvas.height = frame.sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, frame.sw, frame.sh);
  const pixels = ctx.getImageData(0, 0, frame.sw, frame.sh).data;
  let x0 = frame.sw;
  let y0 = frame.sh;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < frame.sh; y += 1) {
    const row = y * frame.sw * 4;
    for (let x = 0; x < frame.sw; x += 1) {
      if (pixels[row + x * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: frame.sw, y1: frame.sh, h: frame.sh };
  return { x0, y0, x1: x1 + 1, y1: y1 + 1, h: y1 + 1 - y0 };
}

function updateAlignmentReference() {
  if (!frames.length) {
    alignmentReference = null;
    return;
  }
  const bounds = frames.map(frame => alphaBounds(frame));
  alignmentReference = {
    originX: median(bounds.map((value, index) => (value.x0 + value.x1) / 2 / frames[index].sw)),
    originY: median(bounds.map((value, index) => value.y1 / frames[index].sh)),
    medianHeight: median(bounds.map(value => value.h)),
    heights: new Map(frames.map((frame, index) => [frame.id, bounds[index].h]))
  };
}

function isSupportedImage(file) {
  return file && (file.type.startsWith('image/') || /\.(png|webp|gif)$/i.test(file.name));
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    objectUrls.push(url);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Не удалось открыть ${file.name}`));
    image.src = url;
  });
}

async function addFrameFiles(fileList) {
  const files = [...fileList]
    .filter(isSupportedImage)
    .sort((a, b) => naturalCollator.compare(a.name, b.name));
  if (!files.length) return;

  const loaded = await Promise.all(files.map(async file => {
    const image = await readImage(file);
    return {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, ''),
      image,
      sx: 0,
      sy: 0,
      sw: image.naturalWidth,
      sh: image.naturalHeight
    };
  }));

  frames.push(...loaded);
  if (frames.length === loaded.length) currentIndex = 0;
  updateAlignmentReference();
  stop();
  renderAll();
}

async function loadSheet(file) {
  if (!isSupportedImage(file)) return;
  const frameWidth = Math.floor(Number(elements.sheetWidth.value));
  const frameHeight = Math.floor(Number(elements.sheetHeight.value));
  if (frameWidth < 1 || frameHeight < 1) return;

  const image = await readImage(file);
  const columns = Math.floor(image.naturalWidth / frameWidth);
  const rows = Math.floor(image.naturalHeight / frameHeight);
  if (!columns || !rows) {
    window.alert('Размер кадра больше самого sprite sheet.');
    return;
  }

  const baseName = file.name.replace(/\.[^.]+$/, '');
  const loaded = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      loaded.push({
        id: crypto.randomUUID(),
        name: `${baseName}-${String(loaded.length).padStart(2, '0')}`,
        image,
        sx: column * frameWidth,
        sy: row * frameHeight,
        sw: frameWidth,
        sh: frameHeight
      });
    }
  }

  frames.push(...loaded);
  if (frames.length === loaded.length) currentIndex = 0;
  updateAlignmentReference();
  stop();
  renderAll();
}

function clearFrames() {
  stop();
  frames = [];
  currentIndex = 0;
  alignmentReference = null;
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  renderAll();
}

function sortFrames() {
  const selectedId = frames[currentIndex]?.id;
  frames.sort((a, b) => naturalCollator.compare(a.name, b.name));
  currentIndex = Math.max(0, frames.findIndex(frame => frame.id === selectedId));
  updateAlignmentReference();
  renderAll();
}

function stop() {
  playing = false;
  lastFrameAt = 0;
  cancelAnimationFrame(animationRequest);
  updateTransport();
}

function togglePlayback() {
  if (!frames.length) return;
  playing = !playing;
  lastFrameAt = 0;
  if (playing) animationRequest = requestAnimationFrame(tick);
  else cancelAnimationFrame(animationRequest);
  updateTransport();
}

function tick(timestamp) {
  if (!playing) return;
  const interval = 1000 / Number(elements.fpsInput.value);
  if (!lastFrameAt) lastFrameAt = timestamp;
  if (timestamp - lastFrameAt >= interval) {
    const steps = Math.floor((timestamp - lastFrameAt) / interval);
    lastFrameAt += steps * interval;
    advance(steps, true);
  }
  animationRequest = requestAnimationFrame(tick);
}

function advance(delta, fromPlayback = false) {
  if (!frames.length) return;
  if (elements.pingPongInput.checked && frames.length > 1 && fromPlayback) {
    for (let step = 0; step < Math.abs(delta); step += 1) {
      let next = currentIndex + direction;
      if (next >= frames.length || next < 0) {
        direction *= -1;
        next = currentIndex + direction;
      }
      currentIndex = next;
    }
  } else {
    currentIndex = (currentIndex + delta + frames.length * (Math.ceil(Math.abs(delta) / frames.length) + 1)) % frames.length;
  }
  drawPreview();
  updateTimelineSelection();
  updateMetadata();
  updateTransport();
}

function resizeCanvas() {
  const bounds = elements.stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (elements.canvas.width !== width || elements.canvas.height !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
  }
  drawPreview();
}

function drawPreview() {
  const dpr = window.devicePixelRatio || 1;
  const width = elements.canvas.width / dpr;
  const height = elements.canvas.height / dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;

  const frame = frames[currentIndex];
  if (!frame) return;

  const useGameAlignment = elements.gameAlignmentInput.checked && alignmentReference;
  const originX = useGameAlignment ? alignmentReference.originX : .5;
  const originY = useGameAlignment ? alignmentReference.originY : .5;
  const contentHeight = useGameAlignment ? alignmentReference.heights.get(frame.id) : frame.sh;
  const scaleMultiplier = useGameAlignment && contentHeight
    ? alignmentReference.medianHeight / contentHeight
    : 1;
  const anchorX = width / 2;
  const anchorY = useGameAlignment ? height * .62 : height / 2;
  const sourceWidth = frame.sw * scaleMultiplier;
  const sourceHeight = frame.sh * scaleMultiplier;
  const availableScales = [
    originX > 0 ? (anchorX - 24) / (originX * sourceWidth) : Infinity,
    originX < 1 ? (width - anchorX - 24) / ((1 - originX) * sourceWidth) : Infinity,
    originY > 0 ? (anchorY - 24) / (originY * sourceHeight) : Infinity,
    originY < 1 ? (height - anchorY - 24) / ((1 - originY) * sourceHeight) : Infinity
  ];
  const requestedScale = Number(elements.zoomInput.value);
  const fitScale = Math.min(...availableScales);
  const scale = Math.max(.1, Math.min(requestedScale, fitScale));
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  const x = Math.round(anchorX - originX * drawWidth);
  const y = Math.round(anchorY - originY * drawHeight);

  if (useGameAlignment) drawAnchorGuide(anchorX, anchorY, width);

  context.save();
  if (elements.flipInput.checked) {
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, width - x - drawWidth, y, drawWidth, drawHeight);
  } else {
    context.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, x, y, drawWidth, drawHeight);
  }
  context.restore();
}

function drawAnchorGuide(x, y, stageWidth) {
  context.save();
  context.setLineDash([5, 5]);
  context.lineWidth = 1;
  context.strokeStyle = '#f2cb6199';
  context.beginPath();
  context.moveTo(24, Math.round(y) + .5);
  context.lineTo(stageWidth - 24, Math.round(y) + .5);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = '#f2cb61';
  context.beginPath();
  context.arc(Math.round(x), Math.round(y), 4, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawThumbnail(canvas, frame) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = 66;
  const cssHeight = 58;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const scale = Math.min((cssWidth - 8) / frame.sw, (cssHeight - 8) / frame.sh);
  const width = Math.max(1, Math.round(frame.sw * scale));
  const height = Math.max(1, Math.round(frame.sh * scale));
  ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, Math.round((cssWidth - width) / 2), Math.round((cssHeight - height) / 2), width, height);
}

function renderTimeline() {
  elements.framesList.replaceChildren();
  frames.forEach((frame, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `frame-card${index === currentIndex ? ' is-current' : ''}`;
    card.draggable = true;
    card.dataset.id = frame.id;
    card.title = frame.name;
    card.setAttribute('aria-label', `Кадр ${index + 1}: ${frame.name}`);

    const thumbnail = document.createElement('canvas');
    const number = document.createElement('span');
    number.className = 'frame-number';
    number.textContent = String(index + 1);
    const label = document.createElement('small');
    label.textContent = frame.name;
    card.append(thumbnail, number, label);
    drawThumbnail(thumbnail, frame);

    card.addEventListener('click', () => {
      currentIndex = frames.findIndex(item => item.id === frame.id);
      drawPreview();
      updateTimelineSelection();
      updateMetadata();
      updateTransport();
    });
    card.addEventListener('dragstart', event => {
      draggedId = frame.id;
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => {
      draggedId = null;
      card.classList.remove('is-dragging');
    });
    card.addEventListener('dragover', event => event.preventDefault());
    card.addEventListener('drop', event => {
      event.preventDefault();
      if (!draggedId || draggedId === frame.id) return;
      const selectedId = frames[currentIndex]?.id;
      const fromIndex = frames.findIndex(item => item.id === draggedId);
      const toIndex = frames.findIndex(item => item.id === frame.id);
      const [moved] = frames.splice(fromIndex, 1);
      frames.splice(toIndex, 0, moved);
      currentIndex = frames.findIndex(item => item.id === selectedId);
      updateAlignmentReference();
      renderAll();
    });

    elements.framesList.append(card);
  });
}

function updateTimelineSelection() {
  elements.framesList.querySelectorAll('.frame-card').forEach((card, index) => {
    card.classList.toggle('is-current', index === currentIndex);
  });
}

function updateTransport() {
  const hasFrames = frames.length > 0;
  [elements.playButton, elements.previousButton, elements.nextButton, elements.clearButton, elements.sortButton]
    .forEach(button => { button.disabled = !hasFrames; });
  elements.playButton.firstElementChild.textContent = playing ? 'Ⅱ' : '▶';
  elements.playButton.lastElementChild.textContent = playing ? 'Пауза' : 'Старт';
  elements.counter.textContent = hasFrames ? `${currentIndex + 1} / ${frames.length}` : '— / —';
}

function updateMetadata() {
  const frame = frames[currentIndex];
  elements.empty.hidden = frames.length > 0;
  elements.title.textContent = frames.length
    ? (frames[0].name.replace(/[-_]?\d+$/, '') || 'Анимация')
    : 'Новая анимация';
  elements.stats.textContent = frame
    ? `${frames.length} ${frameWord(frames.length)} · ${frame.sw}×${frame.sh} px`
    : '0 кадров';
}

function frameWord(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'кадров';
  if (last === 1) return 'кадр';
  if (last >= 2 && last <= 4) return 'кадра';
  return 'кадров';
}

function renderAll() {
  if (currentIndex >= frames.length) currentIndex = Math.max(0, frames.length - 1);
  renderTimeline();
  updateMetadata();
  updateTransport();
  resizeCanvas();
}

elements.dropZone.addEventListener('click', () => elements.framesInput.click());
elements.framesInput.addEventListener('change', event => {
  addFrameFiles(event.target.files).catch(error => window.alert(error.message));
  event.target.value = '';
});
elements.sheetButton.addEventListener('click', () => elements.sheetInput.click());
elements.sheetInput.addEventListener('change', event => {
  loadSheet(event.target.files[0]).catch(error => window.alert(error.message));
  event.target.value = '';
});
elements.clearButton.addEventListener('click', clearFrames);
elements.sortButton.addEventListener('click', sortFrames);
elements.playButton.addEventListener('click', togglePlayback);
elements.previousButton.addEventListener('click', () => { stop(); advance(-1); });
elements.nextButton.addEventListener('click', () => { stop(); advance(1); });
elements.fpsInput.addEventListener('input', () => { elements.fpsOutput.textContent = `${elements.fpsInput.value} FPS`; });
elements.zoomInput.addEventListener('input', () => { elements.zoomOutput.textContent = `${elements.zoomInput.value}×`; drawPreview(); });
elements.gameAlignmentInput.addEventListener('change', drawPreview);
elements.flipInput.addEventListener('change', drawPreview);
elements.pingPongInput.addEventListener('change', () => { direction = 1; });

document.querySelectorAll('input[name="background"]').forEach(input => {
  input.addEventListener('change', () => { elements.stage.className = `stage ${input.value}`; });
});

['dragenter', 'dragover'].forEach(type => {
  window.addEventListener(type, event => {
    event.preventDefault();
    if (event.dataTransfer?.types.includes('Files')) elements.dropZone.classList.add('is-dragging');
  });
});
['dragleave', 'drop'].forEach(type => {
  window.addEventListener(type, event => {
    if (event.dataTransfer?.types.includes('Files')) elements.dropZone.classList.remove('is-dragging');
  });
});
window.addEventListener('drop', event => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  addFrameFiles(event.dataTransfer.files).catch(error => window.alert(error.message));
});
window.addEventListener('keydown', event => {
  if (event.target.matches('input')) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
  if (event.code === 'ArrowLeft') { stop(); advance(-1); }
  if (event.code === 'ArrowRight') { stop(); advance(1); }
});
window.addEventListener('beforeunload', () => objectUrls.forEach(URL.revokeObjectURL));

new ResizeObserver(resizeCanvas).observe(elements.stage);
renderAll();
