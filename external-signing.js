/* No private API calls or passwords: the authenticated app verifies responses. */
'use strict';
const signingBytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const signingBase64 = value => btoa(Array.from(new Uint8Array(value), b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const signingCanonical = value => JSON.stringify((function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
  return v;
})(value));
const signingLanguage = typeof navigator === 'undefined' ? 'en' : (navigator.language || 'en').split('-')[0];
const aloc = text => text.split('|')[({ en: 0, vi: 1, ru: 2 })[signingLanguage] || 0] || text.split('|')[0];
const authorizationChallenge = async challenge => signingBase64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`authorize:${challenge}`)));
if (typeof module !== 'undefined') module.exports = { signingBytes, signingBase64, signingCanonical, aloc, authorizationChallenge };

if (typeof document !== 'undefined') (async () => {
  document.documentElement.lang = signingLanguage;
  document.title = aloc('SIMOPS secure signing|Ký SIMOPS an toàn|Безопасное подписание SIMOPS');
  document.querySelectorAll('[data-aloc]').forEach(el => { el.textContent = aloc(el.dataset.aloc); });
  const element = id => document.getElementById(id);
  let request, responseFile;
  let busy = false;
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(responseFile, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `simops-${request.kind}-${request.requestId}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  try {
    if (!isSecureContext || !navigator.credentials || !window.PublicKeyCredential) throw Error(aloc('Open this page over HTTPS in a browser with passkey support.|Mở trang này qua HTTPS bằng trình duyệt hỗ trợ passkey.|Откройте страницу по HTTPS в браузере с поддержкой ключей доступа.'));
    const encoded = new URLSearchParams(location.hash.slice(1)).get('request');
    if (!encoded || encoded.length > 2000000) throw Error(aloc('Missing or oversized invitation.|Lời mời bị thiếu hoặc quá lớn.|Приглашение отсутствует или слишком велико.'));
    request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(signingBytes(encoded)));
    if (request.v !== 1 || !['enroll', 'approve', 'add', 'replace', 'remove', 'recover', 'login'].includes(request.kind) || request.origin !== location.origin || request.rpId !== location.hostname) throw Error(aloc('This invitation belongs to another signing site.|Lời mời này thuộc trang ký khác.|Это приглашение предназначено для другого сайта.'));
    const expires = Date.parse(request.expiresAt);
    if (!Number.isFinite(expires) || Date.now() >= expires) throw Error(aloc('Invitation expired. Start again in SIMOPS.|Lời mời hết hạn. Bắt đầu lại trong SIMOPS.|Срок приглашения истёк. Начните заново в SIMOPS.'));
    const { challenge, ...boundRequest } = request;
    if (signingBase64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signingCanonical(boundRequest)))) !== challenge) throw Error(aloc('Invitation content was changed. Start again in SIMOPS.|Nội dung lời mời đã bị thay đổi. Bắt đầu lại trong SIMOPS.|Содержимое приглашения изменено. Начните заново в SIMOPS.'));
    const selfService = request.flow === 'selfService';
    const adding = ['enroll', 'add', 'replace', 'recover'].includes(request.kind);
    element('summary').textContent = `SIMOPS · ${aloc('Employee|Nhân viên|Сотрудник')} #${request.signerId} · ${aloc('Expires|Hết hạn|Действует до')} ${new Date(expires).toLocaleString()}`;
    const explanations = {
      login: 'Sign in to your approved external account with your passkey. This does not approve any SIMOPS. Each document requires a separate passkey confirmation.|Đăng nhập tài khoản bên ngoài đã được phê duyệt bằng passkey. Thao tác này không phê duyệt SIMOPS. Mỗi tài liệu cần xác nhận riêng bằng passkey.|Войдите в согласованную внешнюю учётную запись ключом доступа. Это не подписывает SIMOPS. Для каждого документа требуется отдельное подтверждение ключом.',
      enroll: selfService ? 'Register your first passkey. Your domain password was verified inside SIMOPS. This does not approve a document.|Đăng ký passkey đầu tiên. Mật khẩu tên miền đã được xác minh trong SIMOPS. Thao tác này không phê duyệt tài liệu.|Зарегистрируйте первый ключ. Доменный пароль уже проверен в SIMOPS. Это не подписывает документ.' : 'Register your passkey. SIMOPS staff will independently verify your identity and authority. This does not approve a document.|Đăng ký passkey. Nhân viên SIMOPS sẽ xác minh riêng danh tính và quyền ký. Thao tác này không phê duyệt tài liệu.|Зарегистрируйте ключ. Сотрудник SIMOPS отдельно проверит вашу личность и полномочия. Это не подписывает документ.',
      add: 'Authorize with an existing passkey, then create another passkey.|Xác nhận bằng passkey hiện có, sau đó tạo passkey khác.|Подтвердите действующим ключом, затем создайте ещё один ключ.',
      replace: 'Authorize with an existing passkey, then create its replacement. The old public key will be retained.|Xác nhận bằng passkey hiện có, sau đó tạo khóa thay thế. Khóa công khai cũ sẽ được lưu giữ.|Подтвердите действующим ключом и создайте замену. Старый открытый ключ будет сохранён.',
      remove: 'Authorize removal with an existing passkey. Removing your last key requires administrator recovery for future secure signing. Historical signatures remain verifiable.|Xác nhận xóa bằng passkey hiện có. Nếu xóa khóa cuối cùng, cần quản trị viên khôi phục để ký an toàn sau này. Chữ ký cũ vẫn có thể xác minh.|Подтвердите удаление действующим ключом. После удаления последнего ключа понадобится восстановление администратором. Старые подписи останутся проверяемыми.',
      recover: 'Administrator: verify the employee identity and authority, authorize recovery with your own passkey, then let the employee create their new passkey. Previous keys will be revoked and retained.|Quản trị viên: xác minh danh tính và quyền của nhân viên, cho phép khôi phục bằng passkey của bạn, sau đó để nhân viên tạo passkey mới. Khóa cũ sẽ bị thu hồi và lưu giữ.|Администратор: проверьте личность и полномочия сотрудника, подтвердите восстановление своим ключом, затем сотрудник создаст новый ключ. Старые ключи будут отозваны и сохранены.',
      approve: 'I have reviewed the complete SIMOPS document and approve it.|Tôi đã xem toàn bộ tài liệu SIMOPS và phê duyệt.|Я ознакомился с полным документом SIMOPS и одобряю его.'
    };
    element('consent').textContent = aloc(explanations[request.kind]);
    element('confirm').textContent = aloc(request.kind === 'login' ? 'Sign in with passkey|Đăng nhập bằng passkey|Войти с ключом' : request.kind === 'approve' ? 'Secure sign|Ký an toàn|Подписать безопасно' : 'Confirm with passkey|Xác nhận bằng passkey|Подтвердить ключом');
    if (request.document) {
      const heading = document.createElement('h2'); heading.textContent = `${request.document.name} · ${request.document.day}`; element('document').append(heading);
      const comment = document.createElement('p'); comment.textContent = request.document.comment || ''; element('document').append(comment);
      for (const [title, rows, columns] of [
        ['Operations|Công việc|Операции', request.document.operations || [], ['id', 'title', 'startAt', 'endAt', 'workType', 'workBy', 'notes', 'permit', 'jsa']],
        ['Conflicts and controls|Xung đột và biện pháp|Конфликты и меры', request.document.conflicts || [], ['operationAId', 'operationBId', 'level', 'resolved', 'resolutionNotes', 'riskNotes']]
      ]) {
        const h = document.createElement('h3'); h.textContent = aloc(title); element('document').append(h);
        const table = document.createElement('table'); const header = table.insertRow();
        const labels = { id: 'ID|Mã|ID', title: 'Title|Tên|Название', startAt: 'Start|Bắt đầu|Начало', endAt: 'End|Kết thúc|Окончание', workType: 'Work type|Loại công việc|Тип работ', workBy: 'Responsible unit|Đơn vị thực hiện|Исполнитель', notes: 'Notes|Ghi chú|Примечания', permit: 'Permit|Giấy phép|Разрешение', jsa: 'JSA|JSA|JSA', operationAId: 'Operation A|Công việc A|Операция A', operationBId: 'Operation B|Công việc B|Операция B', level: 'Risk level|Mức rủi ro|Уровень риска', resolved: 'Resolved|Đã xử lý|Устранён', resolutionNotes: 'Controls|Biện pháp|Меры', riskNotes: 'Risk notes|Ghi chú rủi ro|Примечания о риске' };
        for (const key of columns) { const th = document.createElement('th'); th.textContent = aloc(labels[key]); header.append(th); }
        for (const row of rows) { const tr = table.insertRow(); for (const key of columns) { const v = row[key]; tr.insertCell().textContent = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); } }
        element('document').append(table);
      }
      element('raw').textContent = JSON.stringify(request.document, null, 2);
    } else { element('document').hidden = true; element('rawDetails').hidden = true; }
    element('reviewed').disabled = false;
    element('reviewed').addEventListener('change', () => { element('confirm').disabled = busy || !element('reviewed').checked || !!responseFile; });
    element('download').addEventListener('click', download);
    const getAssertion = async (challenge, ids) => {
      if (!ids.length) throw Error(aloc('No registered passkey is available.|Không có passkey đã đăng ký.|Нет зарегистрированного ключа.'));
      const assertion = await navigator.credentials.get({ publicKey: { challenge: signingBytes(challenge), rpId: request.rpId, allowCredentials: ids.map(id => ({ type: 'public-key', id: signingBytes(id) })), userVerification: 'required', timeout: 120000 } });
      if (!assertion) throw Error(aloc('Passkey confirmation was cancelled.|Đã hủy xác nhận passkey.|Подтверждение ключом отменено.'));
      return { credentialId: signingBase64(assertion.rawId), clientDataJSON: signingBase64(assertion.response.clientDataJSON), authenticatorData: signingBase64(assertion.response.authenticatorData), signature: signingBase64(assertion.response.signature), userHandle: assertion.response.userHandle ? signingBase64(assertion.response.userHandle) : null };
    };
    element('confirm').addEventListener('click', async () => {
      busy = true; element('confirm').disabled = true;
      try {
        if (Date.now() >= expires) throw Error(aloc('Invitation expired.|Lời mời hết hạn.|Срок приглашения истёк.'));
        let authorization;
        if (selfService && ['add', 'replace', 'recover'].includes(request.kind)) authorization = await getAssertion(await authorizationChallenge(request.challenge), request.credentialIds);
        let credentialId = request.credentialId, publicKey, registration;
        if (adding) {
          element('status').textContent = aloc('Create your passkey, then confirm possession when prompted.|Tạo passkey, sau đó xác nhận quyền sở hữu khi được yêu cầu.|Создайте ключ и подтвердите владение им при запросе.');
          const created = await navigator.credentials.create({ publicKey: { challenge: signingBytes(request.challenge), rp: { id: request.rpId, name: 'SIMOPS' }, user: { id: new TextEncoder().encode(`simops:${request.signerId}`), name: `signer-${request.signerId}`, displayName: `SIMOPS #${request.signerId}` }, excludeCredentials: (request.excludeCredentialIds || []).map(id => ({ type: 'public-key', id: signingBytes(id) })), pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' }, attestation: 'none', timeout: 120000 } });
          if (!created || !created.response.getPublicKey || created.response.getPublicKeyAlgorithm() !== -7) throw Error(aloc('This browser must support ES256 passkeys.|Trình duyệt phải hỗ trợ passkey ES256.|Браузер должен поддерживать ключи ES256.'));
          credentialId = signingBase64(created.rawId);
          const key = await crypto.subtle.importKey('spki', created.response.getPublicKey(), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
          publicKey = await crypto.subtle.exportKey('jwk', key);
          const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([4, ...signingBytes(publicKey.x), ...signingBytes(publicKey.y)]))), b => b.toString(16).padStart(2, '0')).join('');
          const text = document.createElement('p'); text.textContent = `${aloc('Key fingerprint|Dấu vân tay khóa|Отпечаток ключа')} (SHA-256): ${fingerprint}`; element('summary').append(text);
          registration = { clientDataJSON: signingBase64(created.response.clientDataJSON), attestationObject: signingBase64(created.response.attestationObject) };
        }
        responseFile = { v: 1, requestId: request.requestId, ...await getAssertion(request.challenge, adding ? [credentialId] : request.credentialIds || [credentialId]), ...(publicKey ? { publicKey, registration } : {}), ...(authorization ? { authorization } : {}) };
        if (request.returnOrigin && window.opener && new URL(request.returnOrigin).origin === request.returnOrigin) {
          window.opener.postMessage(JSON.stringify({ type: 'simops-passkey-response', response: responseFile }), request.returnOrigin);
          element('status').textContent = aloc('Response sent to SIMOPS for verification. Return to the application for the result.|Đã gửi phản hồi tới SIMOPS để xác minh. Quay lại ứng dụng để xem kết quả.|Ответ передан в SIMOPS на проверку. Вернитесь в приложение за результатом.');
        } else {
          download(); element('status').textContent = aloc('Response downloaded. Return the JSON to your SIMOPS coordinator. It remains pending verification.|Đã tải phản hồi. Gửi JSON cho điều phối viên SIMOPS. Phản hồi đang chờ xác minh.|Ответ скачан. Передайте JSON координатору SIMOPS. Он ожидает проверки.');
        }
        element('download').hidden = false;
      } catch (error) { element('status').textContent = error.name === 'NotAllowedError' ? aloc('Passkey operation cancelled or timed out.|Thao tác passkey bị hủy hoặc hết thời gian.|Операция с ключом отменена или время ожидания истекло.') : error.message || String(error); }
      finally { busy = false; element('confirm').disabled = !element('reviewed').checked || !!responseFile; }
    });
  } catch (error) { element('summary').textContent = error.message || String(error); }
})();
