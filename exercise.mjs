export const SLOT_INFO = {
  guard: {
    step: 1,
    title: "Проверяем выбор",
    hint: "Если список groups пуст, условие должно сработать. Начните с if not groups и закончите двоеточием.",
  },
  list: {
    step: 2,
    title: "Готовим место для пароля",
    hint: "Создайте пустой список [] с именем password_chars.",
  },
  required: {
    step: 3,
    title: "Берём символ каждого типа",
    hint: "Добавьте в password_chars случайный символ из group. Помогут append и secrets.choice(group).",
  },
  pool: {
    step: 4,
    title: "Собираем все символы",
    hint: 'Склейте строки из groups с помощью "".join(groups) и сохраните в all_characters.',
  },
  fill: {
    step: 5,
    title: "Заполняем остальные места",
    hint: "Снова используйте append и secrets.choice, но теперь выбирайте из all_characters.",
  },
  result: {
    step: 6,
    title: "Возвращаем пароль",
    hint: 'Склейте password_chars через "".join(...) и верните строку словом return.',
  },
};

export const DEFAULT_LENGTHS = { min: 8, max: 32, default: 12 };

export function parseLengths(values) {
  const numbers = {};
  for (const key of ["min", "max", "default"]) {
    const raw = String(values?.[key] ?? "");
    if (!/^\d+$/.test(raw)) throw new Error("Для длины нужны целые числа без других символов.");
    numbers[key] = Number(raw);
  }
  if (numbers.min < 4) throw new Error("MIN_LENGTH не может быть меньше 4: типов символов тоже четыре.");
  if (numbers.max > 128) throw new Error("MAX_LENGTH не может быть больше 128.");
  if (numbers.min > numbers.max) throw new Error("MIN_LENGTH должен быть не больше MAX_LENGTH.");
  if (numbers.default < numbers.min || numbers.default > numbers.max) {
    throw new Error("DEFAULT_LENGTH должен находиться между MIN_LENGTH и MAX_LENGTH.");
  }
  return numbers;
}

export const PROGRAM_LINES = [
  { text: "import random", indent: 0 },
  { text: "import secrets", indent: 0 },
  { text: "import string", indent: 0 },
  { text: "", indent: 0 },
  { setting: "min", name: "MIN_LENGTH", indent: 0 },
  { setting: "max", name: "MAX_LENGTH", indent: 0 },
  { setting: "default", name: "DEFAULT_LENGTH", indent: 0 },
  { text: "", indent: 0 },
  { text: "LOWERCASE = string.ascii_lowercase", indent: 0 },
  { text: "UPPERCASE = string.ascii_uppercase", indent: 0 },
  { text: "DIGITS = string.digits", indent: 0 },
  { text: 'SYMBOLS = "!@#$%&*?"', indent: 0 },
  { text: "CHARACTER_GROUPS = {", indent: 0 },
  { text: '"lowercase": LOWERCASE,', indent: 1 },
  { text: '"uppercase": UPPERCASE,', indent: 1 },
  { text: '"digits": DIGITS,', indent: 1 },
  { text: '"symbols": SYMBOLS,', indent: 1 },
  { text: "}", indent: 0 },
  { text: "", indent: 0 },
  { text: "def generate_password(length, groups):", indent: 0 },
  { slot: "guard", indent: 1 },
  { text: 'raise ValueError("Выберите хотя бы один тип символов.")', indent: 2 },
  { slot: "list", indent: 1 },
  { text: "for group in groups:", indent: 1 },
  { slot: "required", indent: 2 },
  { slot: "pool", indent: 1 },
  { text: "for _ in range(length - len(password_chars)):", indent: 1 },
  { slot: "fill", indent: 2 },
  { text: "random.SystemRandom().shuffle(password_chars)", indent: 1 },
  { slot: "result", indent: 1 },
];

export const SLOT_IDS = Object.keys(SLOT_INFO);

export function buildPythonSource(answers, lengthValues = DEFAULT_LENGTHS) {
  const lengths = parseLengths(lengthValues);
  const slotByLine = {};
  const source = PROGRAM_LINES.map((line, index) => {
    const prefix = "    ".repeat(line.indent);
    if (line.setting) return `${prefix}${line.name} = ${lengths[line.setting]}`;
    if (!line.slot) return prefix + line.text;
    slotByLine[index + 1] = line.slot;
    const answer = String(answers[line.slot] ?? "").trim();
    if (answer.includes("\n") || answer.includes("\r")) {
      throw new Error("Каждое поле принимает только одну строку Python.");
    }
    return prefix + answer;
  }).join("\n");

  return { source, slotByLine };
}
