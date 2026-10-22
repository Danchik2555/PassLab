import { DEFAULT_LENGTHS, PROGRAM_LINES, SLOT_IDS, SLOT_INFO, parseLengths } from "./exercise.mjs";

const STORAGE_KEY = "password-workshop-session-v1";
const CHARACTER_SIZES = { lowercase: 26, uppercase: 26, digits: 10, symbols: 8 };
const DEFAULT_KEYS = Object.keys(CHARACTER_SIZES);

const elements = {
  codeRows: document.querySelector("#code-rows"),
  progress: document.querySelector("#progress-badge"),
  codeFeedback: document.querySelector("#code-feedback"),
  runtimeStatus: document.querySelector("#runtime-status"),
  retryButton: document.querySelector("#retry-button"),
  checkButton: document.querySelector("#check-button"),
  resetButton: document.querySelector("#reset-button"),
  tabCode: document.querySelector("#tab-code"),
  tabPreview: document.querySelector("#tab-preview"),
  tabLock: document.querySelector("#tab-lock"),
  panelCode: document.querySelector("#panel-code"),
  panelPreview: document.querySelector("#panel-preview"),
  previewLocked: document.querySelector("#preview-locked"),
  generatorContent: document.querySelector("#generator-content"),
  backToCode: document.querySelector("#back-to-code"),
  passwordLength: document.querySelector("#password-length"),
  lengthValue: document.querySelector("#length-value"),
  options: [...document.querySelectorAll('.option input[type="checkbox"]')],
  generateButton: document.querySelector("#generate-button"),
  passwordValue: document.querySelector("#password-value"),
  strengthValue: document.querySelector("#strength-value"),
  generatorFeedback: document.querySelector("#generator-feedback"),
  copyButton: document.querySelector("#copy-button"),
  copyMessage: document.querySelector("#copy-message"),
  saveLabel: document.querySelector("#save-label"),
};

function loadSavedState() {
  try {
    // Удаляем ответы старой версии, которая хранила их между занятиями.
    try { localStorage.removeItem("password-workshop-v1"); } catch { /* Хранилище может быть запрещено браузером. */ }
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") ?? {};
    const answers = {};
    for (const id of SLOT_IDS) {
      answers[id] = typeof saved.answers?.[id] === "string" ? saved.answers[id].slice(0, 160) : "";
    }
    const lengthValues = Object.fromEntries(
      Object.keys(DEFAULT_LENGTHS).map((key) => [key, String(saved.lengthValues?.[key] ?? DEFAULT_LENGTHS[key]).slice(0, 8)]),
    );
    let limits = DEFAULT_LENGTHS;
    try { limits = parseLengths(lengthValues); } catch { /* Сохраняем ошибочные значения, чтобы их можно было исправить. */ }
    const length = Number.isInteger(saved.length) && saved.length >= limits.min && saved.length <= limits.max
      ? saved.length : limits.default;
    const selectedKeys = Array.isArray(saved.selectedKeys)
      ? saved.selectedKeys.filter((key) => DEFAULT_KEYS.includes(key))
      : [];
    return { answers, lengthValues, length, selectedKeys, wasVerified: saved.verified === true };
  } catch {
    return {
      answers: Object.fromEntries(SLOT_IDS.map((id) => [id, ""])),
      lengthValues: Object.fromEntries(Object.entries(DEFAULT_LENGTHS).map(([key, value]) => [key, String(value)])),
      length: DEFAULT_LENGTHS.default,
      selectedKeys: [],
      wasVerified: false,
    };
  }
}

const state = { ...loadSavedState(), verified: false, revision: 0 };
const slotInputs = new Map();
const settingInputs = new Map();
let worker = null;
let workerReady = false;
let bootTimer = null;
let pending = null;
let requestId = 0;
let currentPassword = "";
let settingsRevision = 0;

function saveState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      answers: state.answers,
      lengthValues: state.lengthValues,
      length: state.length,
      selectedKeys: state.selectedKeys,
      verified: state.verified,
    }));
    if (elements.saveLabel) elements.saveLabel.textContent = "Сохранено в этой вкладке";
  } catch {
    if (elements.saveLabel) elements.saveLabel.textContent = "Не удалось сохранить: проверьте настройки браузера";
  }
}

function feedback(element, message, tone = "neutral") {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("success", "error");
  if (tone !== "neutral") element.classList.add(tone);
}

function updateProgress() {
  const filled = SLOT_IDS.filter((id) => state.answers[id].trim()).length;
  elements.progress.textContent = `${filled} / ${SLOT_IDS.length} строк`;
}

function showTab(name) {
  const preview = name === "preview";
  elements.panelCode.classList.toggle("hidden", preview);
  elements.panelPreview.classList.toggle("hidden", !preview);
  elements.tabCode.classList.toggle("active", !preview);
  elements.tabPreview.classList.toggle("active", preview);
  elements.tabCode.setAttribute("aria-selected", String(!preview));
  elements.tabPreview.setAttribute("aria-selected", String(preview));
}

function clearPassword() {
  currentPassword = "";
  elements.passwordValue.textContent = "Здесь появится пароль";
  elements.strengthValue.textContent = "Не определена";
  elements.strengthValue.className = "";
  elements.copyButton.disabled = true;
  elements.copyMessage.textContent = "";
}

function lockGenerator() {
  state.verified = false;
  elements.tabLock.textContent = "закрыт";
  elements.tabLock.classList.remove("open");
  elements.previewLocked.classList.remove("hidden");
  elements.generatorContent.classList.add("hidden");
  clearPassword();
}

function unlockGenerator() {
  state.verified = true;
  elements.tabLock.textContent = "готов";
  elements.tabLock.classList.add("open");
  elements.previewLocked.classList.add("hidden");
  elements.generatorContent.classList.remove("hidden");
  saveState();
}

function syncLengthControl(useDefault = false) {
  let limits;
  try { limits = parseLengths(state.lengthValues); } catch { limits = DEFAULT_LENGTHS; }
  elements.passwordLength.min = String(limits.min);
  elements.passwordLength.max = String(limits.max);
  if (useDefault || state.length < limits.min || state.length > limits.max) {
    state.length = limits.default;
  }
  elements.passwordLength.value = String(state.length);
  elements.lengthValue.textContent = String(state.length);
}

function renderCode() {
  for (const [index, line] of PROGRAM_LINES.entries()) {
    const row = document.createElement("div");
    row.className = `code-row${line.slot ? " slot-row" : ""}${line.setting ? " constant-row" : ""}`;

    const number = document.createElement("span");
    number.className = "line-number";
    number.textContent = String(index + 1);
    row.append(number);

    const body = document.createElement("div");
    body.className = "line-body";
    body.style.paddingLeft = `${16 + line.indent * 26}px`;

    if (line.setting) {
      const label = document.createElement("span");
      label.className = "code-text";
      label.textContent = `${line.name} = `;
      const input = document.createElement("input");
      input.className = "constant-input";
      input.type = "text";
      input.inputMode = "numeric";
      input.maxLength = 3;
      input.value = state.lengthValues[line.setting];
      input.setAttribute("aria-label", line.name);
      input.addEventListener("input", () => {
        state.lengthValues[line.setting] = input.value;
        state.wasVerified = false;
        state.revision += 1;
        settingsRevision += 1;
        lockGenerator();
        try {
          parseLengths(state.lengthValues);
          for (const field of settingInputs.values()) field.classList.remove("invalid");
          syncLengthControl(true);
          feedback(elements.codeFeedback, "Значения длины сохранены. Проверь код ещё раз.");
        } catch (error) {
          input.classList.add("invalid");
          feedback(elements.codeFeedback, error.message, "error");
        }
        saveState();
      });
      settingInputs.set(line.setting, input);
      body.append(label, input);
      row.append(body);
      elements.codeRows.append(row);
    } else if (line.slot) {
      const info = SLOT_INFO[line.slot];
      const input = document.createElement("input");
      input.className = "code-input";
      input.type = "text";
      input.value = state.answers[line.slot];
      input.placeholder = `Строка ${info.step}: ${info.title}`;
      input.maxLength = 160;
      input.spellcheck = false;
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.setAttribute("aria-label", `Строка ${info.step}. ${info.title}`);
      input.addEventListener("input", () => {
        state.answers[line.slot] = input.value;
        state.wasVerified = false;
        state.revision += 1;
        input.classList.remove("invalid");
        lockGenerator();
        updateProgress();
        saveState();
        feedback(elements.codeFeedback, "Строка сохранена. Проверь код, когда заполнишь все поля.");
      });
      slotInputs.set(line.slot, input);
      body.append(input);

      const hintButton = document.createElement("button");
      hintButton.className = "hint-button";
      hintButton.type = "button";
      hintButton.textContent = "Подсказка";
      hintButton.setAttribute("aria-expanded", "false");
      const hint = document.createElement("div");
      hint.className = "hint-row hidden";
      const title = document.createElement("strong");
      title.textContent = `Строка ${info.step}. ${info.title}. `;
      hint.append(title, document.createTextNode(info.hint));
      hintButton.addEventListener("click", () => {
        const isHidden = hint.classList.toggle("hidden");
        hintButton.setAttribute("aria-expanded", String(!isHidden));
      });
      body.append(hintButton);
      row.append(body);
      elements.codeRows.append(row, hint);
    } else {
      const code = document.createElement("span");
      code.className = "code-text";
      code.textContent = line.text || " ";
      body.append(code);
      row.append(body);
      elements.codeRows.append(row);
    }
  }
}

function failRuntime(message) {
  clearTimeout(bootTimer);
  worker?.terminate();
  worker = null;
  workerReady = false;
  if (pending) {
    clearTimeout(pending.timer);
    pending.resolve({ error: message });
    pending = null;
  }
  if (elements.runtimeStatus) elements.runtimeStatus.textContent = message;
  elements.checkButton.disabled = true;
  elements.generateButton.disabled = true;
  elements.retryButton.classList.remove("hidden");
}

function startWorker() {
  worker?.terminate();
  workerReady = false;
  elements.checkButton.disabled = true;
  elements.generateButton.disabled = true;
  elements.retryButton.classList.add("hidden");
  if (elements.runtimeStatus) elements.runtimeStatus.textContent = "Загрузка Python…";
  try {
    worker = new Worker(new URL("./python-worker.mjs", import.meta.url), { type: "module" });
  } catch {
    failRuntime("Не удалось запустить Python в этом браузере. Откройте сайт в Chrome или Edge.");
    return;
  }
  bootTimer = setTimeout(() => failRuntime("Python загружается слишком долго."), 90000);

  worker.onmessage = (event) => {
    const data = event.data;
    if (data.type === "ready") {
      clearTimeout(bootTimer);
      workerReady = true;
      if (elements.runtimeStatus) elements.runtimeStatus.textContent = "Python готов";
      elements.checkButton.disabled = false;
      elements.generateButton.disabled = false;
      if (state.wasVerified && SLOT_IDS.every((id) => state.answers[id].trim())) {
        state.wasVerified = false;
        checkCode(true);
      }
      return;
    }
    if (data.type === "boot-error") {
      failRuntime("Не удалось загрузить Python. Проверьте файлы сайта.");
      return;
    }
    if (!pending || data.id !== pending.id) return;
    clearTimeout(pending.timer);
    pending.resolve(data);
    pending = null;
  };
  worker.onerror = () => failRuntime("Python остановился. Нажмите «Повторить загрузку».");
}

function askWorker(type, payload) {
  if (!workerReady || !worker) return Promise.resolve({ error: "Python ещё не загрузился." });
  if (pending) return Promise.resolve({ error: "Подождите завершения предыдущей проверки." });
  return new Promise((resolve) => {
    const id = ++requestId;
    const timer = setTimeout(() => {
      pending = null;
      resolve({ error: "Программа выполнялась слишком долго. Проверьте строки и попробуйте снова." });
      startWorker();
    }, 5000);
    pending = { id, timer, resolve };
    worker.postMessage({ id, type, ...payload });
  });
}

function readableError(error) {
  const lines = String(error).trim().split("\n").filter(Boolean);
  const lastLine = lines.at(-1) ?? "Неизвестная ошибка Python.";
  if (lastLine === "SyntaxError: expected ':'") return "в конце условия нужно двоеточие (:).";
  if (lastLine.startsWith("SyntaxError:")) return "ошибка в записи строки Python; проверь скобки, кавычки и двоеточия.";
  return lastLine;
}

async function checkCode(restoring = false) {
  for (const input of slotInputs.values()) input.classList.remove("invalid");
  let lengths;
  try {
    lengths = parseLengths(state.lengthValues);
    for (const input of settingInputs.values()) input.classList.remove("invalid");
  } catch (error) {
    for (const input of settingInputs.values()) input.classList.add("invalid");
    feedback(elements.codeFeedback, error.message, "error");
    return;
  }
  const missing = SLOT_IDS.find((id) => !state.answers[id].trim());
  if (missing) {
    slotInputs.get(missing).classList.add("invalid");
    slotInputs.get(missing).focus();
    feedback(elements.codeFeedback, `Сначала заполни строку ${SLOT_INFO[missing].step}.`, "error");
    return;
  }

  const revision = state.revision;
  elements.checkButton.disabled = true;
  feedback(elements.codeFeedback, "Проверяю программу…");
  const reply = await askWorker("check", { answers: { ...state.answers }, lengths });
  elements.checkButton.disabled = !workerReady;
  if (revision !== state.revision) return;

  if (reply.error) {
    if (reply.slotId && slotInputs.has(reply.slotId)) {
      slotInputs.get(reply.slotId).classList.add("invalid");
    }
    const prefix = reply.slotId ? `Проверь строку ${SLOT_INFO[reply.slotId].step}. ` : "";
    feedback(elements.codeFeedback, `${prefix}Ошибка Python: ${readableError(reply.error)}`, "error");
    saveState();
    return;
  }
  if (!reply.result?.ok) {
    if (reply.slotId && slotInputs.has(reply.slotId)) slotInputs.get(reply.slotId).classList.add("invalid");
    const prefix = reply.slotId ? `Ошибка при выполнении строки ${SLOT_INFO[reply.slotId].step}. Проверь её и строки выше. ` : "";
    feedback(elements.codeFeedback, prefix + (reply.result?.message ?? "Программа пока не прошла проверку."), "error");
    saveState();
    return;
  }

  unlockGenerator();
  feedback(elements.codeFeedback, "Готово! Все проверки пройдены. Открой вкладку «Генератор».", "success");
  if (!restoring) {
    showTab("preview");
    await generatePassword();
  }
}

function selectedKeys() {
  return elements.options.filter((option) => option.checked).map((option) => option.value);
}

function showStrength(length, keys) {
  const poolSize = keys.reduce((total, key) => total + CHARACTER_SIZES[key], 0);
  const bits = length * Math.log2(poolSize);
  let label = "Высокая";
  let cssClass = "high";
  if (bits < 50) {
    label = "Низкая";
    cssClass = "low";
  } else if (bits < 80) {
    label = "Средняя";
    cssClass = "medium";
  }
  elements.strengthValue.textContent = label;
  elements.strengthValue.className = cssClass;
}

async function generatePassword() {
  if (!state.verified) return;
  const keys = selectedKeys();
  if (!keys.length) {
    clearPassword();
    if (!elements.generatorFeedback) elements.passwordValue.textContent = "Выбери хотя бы один тип символов.";
    feedback(elements.generatorFeedback, "Выбери хотя бы один тип символов.", "error");
    return;
  }

  const revision = settingsRevision;
  elements.generateButton.disabled = true;
  feedback(elements.generatorFeedback, "Python создаёт пароль…");
  const reply = await askWorker("generate", {
    answers: { ...state.answers },
    lengths: parseLengths(state.lengthValues),
    length: state.length,
    keys,
  });
  elements.generateButton.disabled = !workerReady;
  if (revision !== settingsRevision) return;
  if (reply.error || !reply.result?.ok || typeof reply.result.password !== "string") {
    clearPassword();
    const message = reply.error ? `Ошибка Python: ${readableError(reply.error)}` : reply.result?.message ?? "Не удалось создать пароль.";
    if (!elements.generatorFeedback) elements.passwordValue.textContent = message;
    feedback(elements.generatorFeedback, message, "error");
    return;
  }

  currentPassword = reply.result.password;
  elements.passwordValue.textContent = currentPassword;
  elements.copyButton.disabled = false;
  elements.copyMessage.textContent = "";
  showStrength(state.length, keys);
  feedback(elements.generatorFeedback, "Пароль создан твоим Python-кодом в этом браузере.", "success");
}

function selectPasswordText() {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(elements.passwordValue);
  selection.removeAllRanges();
  selection.addRange(range);
}

async function copyPassword() {
  if (!currentPassword) return;
  try {
    if (!window.isSecureContext || !navigator.clipboard?.writeText) {
      throw new Error("Clipboard API недоступен по HTTP");
    }
    await navigator.clipboard.writeText(currentPassword);
    elements.copyMessage.textContent = "Пароль скопирован.";
  } catch {
    selectPasswordText();
    elements.copyMessage.textContent = "Пароль выделен. Нажми Ctrl+C (на Mac — ⌘C).";
  }
}

renderCode();
updateProgress();
syncLengthControl();
for (const option of elements.options) option.checked = state.selectedKeys.includes(option.value);
startWorker();

elements.tabCode.addEventListener("click", () => showTab("code"));
elements.tabPreview.addEventListener("click", () => showTab("preview"));
elements.backToCode.addEventListener("click", () => showTab("code"));
elements.checkButton.addEventListener("click", () => checkCode());
elements.retryButton.addEventListener("click", startWorker);
elements.generateButton.addEventListener("click", generatePassword);
elements.copyButton.addEventListener("click", copyPassword);
elements.passwordLength.addEventListener("input", () => {
  state.length = Number(elements.passwordLength.value);
  elements.lengthValue.textContent = String(state.length);
  settingsRevision += 1;
  clearPassword();
  feedback(elements.generatorFeedback, "Настройки изменены. Нажми «Сгенерировать пароль».");
  saveState();
});
for (const option of elements.options) {
  option.addEventListener("change", () => {
    state.selectedKeys = selectedKeys();
    settingsRevision += 1;
    clearPassword();
    feedback(elements.generatorFeedback, "Настройки изменены. Нажми «Сгенерировать пароль».");
    saveState();
  });
}
elements.resetButton.addEventListener("click", () => {
  if (!window.confirm("Удалить все шесть введённых строк в этом браузере?")) return;
  for (const id of SLOT_IDS) {
    state.answers[id] = "";
    slotInputs.get(id).value = "";
    slotInputs.get(id).classList.remove("invalid");
  }
  state.revision += 1;
  lockGenerator();
  updateProgress();
  saveState();
  showTab("code");
  feedback(elements.codeFeedback, "Строки очищены. Можно начать заново.");
});
