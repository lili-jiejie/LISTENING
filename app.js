const AUDIO_ROOT = "DTJ262《简·六级听力》配套音频/";
const START_DATE = new Date(2026, 9, 30);
const LESSON_COUNT = 25;
const COMPLETED_KEY = "tingli-completed-days";
const TRANSLATION_KEY = "tingli-translations-v1";

const stages = [
  { max: 3, folder: "1-基础带练篇", label: "基础带练", kicker: "FOUNDATION" },
  { max: 15, folder: "2-进阶强化篇", label: "进阶强化", kicker: "BUILDING UP" },
  { max: 25, folder: "3-特训冲刺篇", label: "特训冲刺", kicker: "FINAL SPRINT" },
];

const homeView = document.querySelector("#home-view");
const lessonView = document.querySelector("#lesson-view");
const dateGrid = document.querySelector("#date-grid");
const audio = document.querySelector("#audio");
const transcriptList = document.querySelector("#transcript-list");
const seekBar = document.querySelector("#seek-bar");
const playButton = document.querySelector("#play-button");
const playIcon = document.querySelector("#play-icon");
const audioStatus = document.querySelector("#audio-status");
const translationCache = readCache(TRANSLATION_KEY);
let completedDays = readCache(COMPLETED_KEY);
if (!Array.isArray(completedDays)) completedDays = [];
let currentLesson = null;
let transcript = [];
let activeIndex = -1;
let pendingSeek = null;
let translationController = null;
let translationTimer = 0;

function readCache(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? {};
  } catch {
    return {};
  }
}

function dateForDay(day) {
  const date = new Date(START_DATE);
  date.setDate(START_DATE.getDate() + day - 1);
  return date;
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

function stageForDay(day) {
  return stages.find((stage) => day <= stage.max);
}

function renderCalendar() {
  dateGrid.replaceChildren();
  for (let day = 1; day <= LESSON_COUNT; day += 1) {
    const date = dateForDay(day);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-card";
    if (day === 1) button.classList.add("is-today");
    if (completedDays.includes(day)) button.classList.add("is-complete");
    button.setAttribute("aria-label", `第 ${day} 天，${formatDate(date, { month: "long", day: "numeric" })}，${completedDays.includes(day) ? "已完成" : "开始训练"}`);
    const state = completedDays.includes(day) ? '<span class="date-state" aria-label="已完成">✓</span>' : "";
    button.innerHTML = `<span class="date-top"><span class="date-number">${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}</span><span class="day-number">DAY ${String(day).padStart(2, "0")}</span></span><span class="date-bottom"><span class="date-label">${stageForDay(day).label}</span>${state}</span>`;
    button.addEventListener("click", () => openLesson(day));
    dateGrid.append(button);
  }
  const doneCount = completedDays.length;
  document.querySelector("#progress-label").textContent = `${doneCount} / ${LESSON_COUNT} 天`;
  document.querySelector("#progress-bar").style.width = `${(doneCount / LESSON_COUNT) * 100}%`;
}

function audioPaths(day) {
  const stage = stageForDay(day);
  const extension = day === 6 || day === 18 ? "MP3" : "mp3";
  const base = `${AUDIO_ROOT}${stage.folder}/Model Test ${day}`;
  return { audio: `${base}.${extension}`, lrc: `${base}.lrc`, stage };
}

function parseLrc(contents) {
  return contents.split(/\r?\n/).flatMap((rawLine) => {
    const timestamps = [...rawLine.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = rawLine.replace(/\[[^\]]+\]/g, "").trim();
    if (!timestamps.length || !text) return [];
    return timestamps.map((match) => ({
      time: Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || "0"}`),
      text,
    }));
  }).sort((a, b) => a.time - b.time);
}

async function openLesson(day) {
  const paths = audioPaths(day);
  currentLesson = { day, ...paths };
  window.clearTimeout(translationTimer);
  translationController?.abort();
  document.querySelector("#lesson-title").textContent = `Model Test ${day}`;
  document.querySelector("#track-name").textContent = `Model Test ${day}`;
  document.querySelector("#lesson-kicker").textContent = `DAY ${String(day).padStart(2, "0")} · ${paths.stage.kicker}`;
  document.querySelector("#lesson-badge").textContent = paths.stage.label;
  document.querySelector("#lesson-date").textContent = formatDate(dateForDay(day), { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  document.querySelector("#complete-button").textContent = completedDays.includes(day) ? "今天已完成 ✓" : "完成今天的训练 →";
  homeView.classList.add("hidden");
  lessonView.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });

  audio.pause();
  pendingSeek = null;
  audio.src = encodeURI(paths.audio);
  audio.load();
  transcriptList.replaceChildren();
  transcriptList.innerHTML = '<p class="loading-message">正在载入听力原文…</p>';
  transcript = [];
  activeIndex = -1;
  try {
    const response = await fetch(encodeURI(paths.lrc));
    if (!response.ok) throw new Error(`字幕文件加载失败（${response.status}）`);
    const contents = new TextDecoder("gb18030").decode(await response.arrayBuffer());
    transcript = parseLrc(contents);
    if (!transcript.length) throw new Error("字幕文件中没有找到有效的时间轴");
    renderTranscript();
    setAudioStatus("准备就绪");
  } catch (error) {
    transcriptList.innerHTML = `<p class="error-message">${escapeHtml(error.message)}。请确认网页通过本地服务器打开，且字幕文件仍在原目录中。</p>`;
  }
}

function renderTranscript() {
  const fragment = document.createDocumentFragment();
  transcript.forEach((line, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "transcript-line";
    button.dataset.index = String(index);
    button.innerHTML = `<span class="line-time">${formatTime(line.time)}</span><span class="line-copy"><span class="line-english"></span><span class="line-translation" aria-live="polite">点击句子，显示中文翻译</span></span>`;
    button.querySelector(".line-english").textContent = line.text;
    button.addEventListener("click", () => seekToLine(index));
    fragment.append(button);
  });
  transcriptList.replaceChildren(fragment);
  if (transcript.length) updateActiveLine(0, true);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function setAudioStatus(message, playing = false) {
  audioStatus.textContent = message;
  audioStatus.classList.toggle("is-playing", playing);
}

function updateActiveLine(index, force = false) {
  if (!transcript.length || index < 0 || index >= transcript.length) return;
  if (!force && index === activeIndex) return;
  activeIndex = index;
  transcriptList.querySelector(".is-active")?.classList.remove("is-active");
  const row = transcriptList.querySelector(`[data-index="${index}"]`);
  row?.classList.add("is-active");
  row?.scrollIntoView({ block: "center", behavior: "smooth" });
  requestTranslation(index);
}

function seekToLine(index) {
  const line = transcript[index];
  if (!line) return;
  updateActiveLine(index, true);
  seekAudio(line.time, true);
}

function seekAudio(time, play = pendingSeek?.play ?? false) {
  const target = Math.max(0, time);
  pendingSeek = { time: target, play };
  applyPendingSeek();
}

function applyPendingSeek() {
  if (!pendingSeek || audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
  if (!Number.isFinite(audio.duration) && audio.duration !== Infinity) return;
  if (audio.duration === 0) return;

  const { time, play } = pendingSeek;
  pendingSeek = null;
  audio.currentTime = Number.isFinite(audio.duration) ? Math.min(time, audio.duration) : time;
  if (play) audio.play().catch(() => setAudioStatus("音频无法播放，请检查文件或浏览器设置"));
}

function seekBy(seconds) {
  seekAudio((pendingSeek?.time ?? audio.currentTime) + seconds);
}

function findActiveLine(time) {
  let low = 0;
  let high = transcript.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (transcript[middle].time <= time) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

function requestTranslation(index) {
  const line = transcript[index];
  const translation = transcriptList.querySelector(`[data-index="${index}"] .line-translation`);
  const lessonDay = currentLesson?.day;
  if (!line || !translation) return;
  const cached = translationCache[line.text];
  if (cached) {
    translation.textContent = cached;
    translation.classList.remove("is-loading", "is-error");
    return;
  }
  translation.textContent = "正在翻译…";
  translation.classList.add("is-loading");
  translation.classList.remove("is-error");
  window.clearTimeout(translationTimer);
  translationController?.abort();
  translationController = new AbortController();
  const signal = translationController.signal;
  translationTimer = window.setTimeout(async () => {
    try {
      const url = new URL("https://translate.googleapis.com/translate_a/single");
      url.search = new URLSearchParams({ client: "gtx", sl: "en", tl: "zh-CN", dt: "t", q: line.text });
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`翻译服务返回 ${response.status}`);
      const result = await response.json();
      const translated = result[0].map((part) => part[0] || "").join("").trim();
      if (!translated) throw new Error("翻译服务未返回内容");
      translationCache[line.text] = translated;
      try {
        localStorage.setItem(TRANSLATION_KEY, JSON.stringify(translationCache));
      } catch {
        // Keep the in-memory translation if browser storage is unavailable or full.
      }
      if (currentLesson?.day === lessonDay && transcript[index]?.text === line.text) {
        const currentTranslation = transcriptList.querySelector(`[data-index="${index}"] .line-translation`);
        if (currentTranslation) {
          currentTranslation.textContent = translated;
          currentTranslation.classList.remove("is-loading", "is-error");
        }
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      const currentTranslation = currentLesson?.day === lessonDay && transcript[index]?.text === line.text
        ? transcriptList.querySelector(`[data-index="${index}"] .line-translation`)
        : null;
      if (currentTranslation) {
        currentTranslation.textContent = "翻译暂时不可用，请检查网络后重新点选此句。";
        currentTranslation.classList.remove("is-loading");
        currentTranslation.classList.add("is-error");
      }
    }
  }, 300);
}

function togglePlayback() {
  if (audio.paused) {
    audio.play().catch(() => setAudioStatus("音频无法播放，请检查文件或浏览器设置"));
  } else {
    audio.pause();
  }
}

function markComplete() {
  if (!currentLesson) return;
  if (!completedDays.includes(currentLesson.day)) {
    completedDays.push(currentLesson.day);
    completedDays.sort((a, b) => a - b);
    localStorage.setItem(COMPLETED_KEY, JSON.stringify(completedDays));
    renderCalendar();
  }
  document.querySelector("#complete-button").textContent = "今天已完成 ✓";
}

document.querySelector("#home-link").addEventListener("click", (event) => {
  event.preventDefault();
  audio.pause();
  lessonView.classList.add("hidden");
  homeView.classList.remove("hidden");
  renderCalendar();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
document.querySelector("#back-button").addEventListener("click", () => document.querySelector("#home-link").click());
document.querySelector("#complete-button").addEventListener("click", markComplete);
playButton.addEventListener("click", togglePlayback);
document.querySelector("#back-five").addEventListener("click", () => seekBy(-5));
document.querySelector("#forward-five").addEventListener("click", () => seekBy(5));
seekBar.addEventListener("input", () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(seekBar.value) / 1000) * audio.duration;
});
audio.addEventListener("play", () => {
  playIcon.textContent = "Ⅱ";
  playButton.setAttribute("aria-label", "暂停");
  setAudioStatus("正在播放", true);
});
audio.addEventListener("pause", () => {
  playIcon.textContent = "▶";
  playButton.setAttribute("aria-label", "播放");
  if (!audio.ended) setAudioStatus("已暂停");
});
audio.addEventListener("loadedmetadata", () => {
  document.querySelector("#duration").textContent = formatTime(audio.duration);
  applyPendingSeek();
});
audio.addEventListener("durationchange", applyPendingSeek);
audio.addEventListener("timeupdate", () => {
  document.querySelector("#current-time").textContent = formatTime(audio.currentTime);
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    const progress = (audio.currentTime / audio.duration) * 100;
    seekBar.value = String(Math.round(progress * 10));
    seekBar.style.setProperty("--seek", `${progress}%`);
  }
  if (transcript.length) updateActiveLine(findActiveLine(audio.currentTime));
});
audio.addEventListener("ended", () => {
  setAudioStatus("练习完成");
  markComplete();
});
audio.addEventListener("error", () => {
  if (currentLesson) setAudioStatus("音频加载失败，请检查音频文件路径");
});
document.addEventListener("keydown", (event) => {
  if (lessonView.classList.contains("hidden")) return;
  if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    seekBy(-5);
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    seekBy(5);
  }
});

renderCalendar();
