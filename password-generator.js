export const CATEGORY_SETS = Object.freeze({
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lowercase: 'abcdefghijkmnopqrstuvwxyz',
  numbers: '23456789',
  symbols: '!@#$%^&*()-_=+[]{}:,.?'
});

export function validatePasswordSettings({ length, categories }) {
  if (!Array.isArray(categories) || categories.length === 0) return '請至少選擇一種字元類別。';
  if (!Number.isInteger(length) || length < 12 || length > 128) return '密碼長度必須介於 12 至 128 個字元。';
  if (length < categories.length) return '密碼長度不能少於已選擇的字元類別數。';
  if (categories.some((category) => !CATEGORY_SETS[category])) return '包含無效的字元類別。';
  return '';
}

function secureIndex(limit, crypto) {
  const ceiling = 256 - (256 % limit);
  const random = new Uint8Array(1);
  do { crypto.getRandomValues(random); } while (random[0] >= ceiling);
  return random[0] % limit;
}

function secureShuffle(values, crypto) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = secureIndex(index + 1, crypto);
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

export function generatePassword(settings, crypto = globalThis.crypto) {
  const error = validatePasswordSettings(settings);
  if (error) throw new Error(error);
  if (!crypto?.getRandomValues) throw new Error('此瀏覽器不支援安全亂數產生。');
  const { length, categories } = settings;
  const enabledSets = categories.map((category) => CATEGORY_SETS[category]);
  const allCharacters = enabledSets.join('');
  const characters = enabledSets.map((set) => set[secureIndex(set.length, crypto)]);
  while (characters.length < length) characters.push(allCharacters[secureIndex(allCharacters.length, crypto)]);
  return secureShuffle(characters, crypto).join('');
}

export function strengthGuidance(length, categories) {
  const poolSize = categories.reduce((total, category) => total + CATEGORY_SETS[category].length, 0);
  const bits = Math.floor(length * Math.log2(poolSize));
  const label = bits >= 80 ? '高強度' : bits >= 60 ? '良好強度' : '建議加長';
  return { poolSize, bits, label };
}

function initialisePasswordGenerator() {
  const form = document.getElementById('password-settings');
  if (!form) return;
  const lengthInput = document.getElementById('password-length');
  const output = document.getElementById('password-output');
  const status = document.getElementById('password-status');
  const error = document.getElementById('password-error');
  const guidance = document.getElementById('password-guidance');
  const copy = document.getElementById('copy-password');
  const regenerate = document.getElementById('regenerate-password');
  const currentSettings = () => ({ length: Number(lengthInput.value), categories: [...form.querySelectorAll('input[name="category"]:checked')].map((input) => input.value) });
  const renderGuidance = (settings) => {
    const { poolSize, bits, label } = strengthGuidance(settings.length, settings.categories);
    guidance.textContent = `${label}：${settings.length} 個字元、${settings.categories.length} 種類別，字元池 ${poolSize} 種，約 ${bits} 位元組合強度。`;
  };
  const generate = () => {
    const settings = currentSettings();
    const validationError = validatePasswordSettings(settings);
    error.textContent = validationError;
    if (validationError) { status.textContent = '設定需要修正'; return false; }
    try {
      const password = generatePassword(settings);
      output.value = password;
      document.getElementById('password-result-length').textContent = `長度：${password.length} 個字元`;
      renderGuidance(settings);
      status.textContent = '已安全產生新密碼';
      return true;
    } catch (generationError) {
      error.textContent = generationError.message;
      status.textContent = '無法產生密碼';
      return false;
    }
  };
  const validate = () => {
    const settings = currentSettings();
    const validationError = validatePasswordSettings(settings);
    error.textContent = validationError;
    if (!validationError) renderGuidance(settings);
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); generate(); });
  form.addEventListener('change', validate);
  lengthInput.addEventListener('input', validate);
  regenerate.addEventListener('click', generate);
  copy.addEventListener('click', async () => {
    if (!output.value) { status.textContent = '請先產生有效密碼'; return; }
    if (!navigator.clipboard?.writeText) { status.textContent = '無法使用剪貼簿，請手動複製。'; return; }
    try { await navigator.clipboard.writeText(output.value); status.textContent = '密碼已複製到剪貼簿'; }
    catch { status.textContent = '無法複製密碼，請手動複製。'; }
  });
  generate();
}

if (typeof document !== 'undefined') initialisePasswordGenerator();
