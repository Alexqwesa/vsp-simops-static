'use strict';

function registrationRequest(fields) {
  const request = { v: 1, kind: 'external-registration' };
  for (const key of ['fullName', 'company', 'position', 'email']) {
    if (typeof fields[key] !== 'string') throw new Error('Invalid registration');
    const value = fields[key].trim();
    if (!value || value.length > (key === 'email' ? 254 : 200) || /[\x00-\x1f]/.test(value)) throw new Error('Invalid registration');
    request[key] = key === 'email' ? value.toLowerCase() : value;
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(request.email)) throw new Error('Invalid email');
  const eula = fields.eula;
  if (!(eula === true || eula === 'on' || eula === 'true' || eula === '1')) {
    throw new Error('EULA required');
  }
  request.eulaAccepted = true;
  request.eulaVersion = 1;
  return request;
}

if (typeof module !== 'undefined') module.exports = { registrationRequest };

if (typeof document !== 'undefined') {
  const languages = ['en', 'vi', 'ru'];
  const language = document.getElementById('language');
  language.value = languages.includes(navigator.language.slice(0, 2)) ? navigator.language.slice(0, 2) : 'en';
  const aloc = text => text.split('|')[languages.indexOf(language.value)];
  const translate = () => {
    document.documentElement.lang = language.value;
    for (const element of document.querySelectorAll('[data-aloc]')) element.textContent = aloc(element.dataset.aloc);
    document.getElementById('status').textContent = '';
  };
  language.addEventListener('change', translate);
  translate();
  document.getElementById('registration').addEventListener('submit', event => {
    event.preventDefault();
    const status = document.getElementById('status');
    try {
      const request = registrationRequest(Object.fromEntries(new FormData(event.target)));
      const url = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'simops-external-registration.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = aloc('Send the downloaded file to your VSP coordinator. Your profile remains pending until VSP reviews it.|Gửi tệp đã tải cho điều phối viên VSP. Hồ sơ chờ VSP xét duyệt.|Передайте скачанный файл координатору ВСП. Профиль ожидает проверки ВСП.');
    } catch {
      status.textContent = aloc('Enter a valid name, company, position and email.|Nhập họ tên, công ty, chức danh và email hợp lệ.|Укажите ФИО, компанию, должность и действующую почту.');
    }
  });
}
