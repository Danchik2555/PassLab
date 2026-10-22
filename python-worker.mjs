import { loadPyodide } from "./vendor/pyodide/pyodide.mjs";
import { buildPythonSource, parseLengths } from "./exercise.mjs";

const pyodideReady = loadPyodide({
  indexURL: new URL("./vendor/pyodide/", import.meta.url).href,
});

pyodideReady.then(
  () => self.postMessage({ type: "ready" }),
  (error) => self.postMessage({ type: "boot-error", message: String(error) }),
);

const CHECK_CODE = `
import json
import traceback

def _failure(error, prefix):
    line = traceback.extract_tb(error.__traceback__)[-1].lineno
    return {"ok": False, "message": prefix + str(error), "line": line}

def _check_student_code():
    try:
        generate_password(DEFAULT_LENGTH, [])
    except ValueError:
        pass
    except Exception as error:
        return _failure(error, "Проверьте ошибку при пустом выборе: ")
    else:
        return {"ok": False, "message": "При пустом выборе программа должна показать ошибку."}

    cases = [
        (MIN_LENGTH, [LOWERCASE]),
        (DEFAULT_LENGTH, [LOWERCASE, DIGITS]),
        (MAX_LENGTH, [LOWERCASE, UPPERCASE, DIGITS, SYMBOLS]),
    ]
    for length, groups in cases:
        try:
            password = generate_password(length, groups)
        except Exception as error:
            return _failure(error, "Не удалось создать пароль: ")
        if not isinstance(password, str):
            return {"ok": False, "message": "Функция должна вернуть готовый пароль строкой."}
        if len(password) != length:
            return {"ok": False, "message": "Длина пароля должна совпадать с выбранной длиной."}
        if not set(password).issubset(set("".join(groups))):
            return {"ok": False, "message": "В пароле появился символ из выключенного набора."}
        if any(not any(character in group for character in password) for group in groups):
            return {"ok": False, "message": "В пароле нужен хотя бы один символ каждого выбранного типа."}
    return {"ok": True}

json.dumps(_check_student_code(), ensure_ascii=False)
`;

function generationCode(length, keys) {
  const allowedKeys = ["lowercase", "uppercase", "digits", "symbols"];
  const selected = keys.filter((key) => allowedKeys.includes(key));
  return `
import json

_groups = [CHARACTER_GROUPS[key] for key in ${JSON.stringify(selected)}]
try:
    _password = generate_password(${length}, _groups)
    _result = {"ok": True, "password": _password}
except ValueError as error:
    _result = {"ok": False, "message": str(error)}
json.dumps(_result, ensure_ascii=False)
`;
}

self.onmessage = async (event) => {
  const { id, type, answers, length, keys, lengths } = event.data;
  let globals;
  let slotByLine = {};
  try {
    const pyodide = await pyodideReady;
    const limits = parseLengths(lengths);
    const built = buildPythonSource(answers, limits);
    const { source } = built;
    slotByLine = built.slotByLine;
    if (type !== "check" && type !== "generate") {
      throw new Error("Неизвестная команда для Python.");
    }
    if (type === "generate" && (!Number.isInteger(length) || length < limits.min || length > limits.max)) {
      throw new Error(`Выберите длину от ${limits.min} до ${limits.max} символов.`);
    }

    const dict = pyodide.globals.get("dict");
    globals = dict();
    dict.destroy();
    const code = source + (type === "check" ? CHECK_CODE : generationCode(length, keys));
    const result = JSON.parse(await pyodide.runPythonAsync(code, { globals }));
    self.postMessage({ id, result, slotId: slotByLine[result.line] ?? null });
  } catch (error) {
    const message = String(error?.message ?? error);
    const slotId = [...message.matchAll(/line (\d+)/g)]
      .map((match) => slotByLine[Number(match[1])])
      .find(Boolean) ?? null;
    self.postMessage({ id, error: message, slotId });
  } finally {
    globals?.destroy();
  }
};
