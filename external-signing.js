/* No private API calls or passwords: the authenticated app verifies responses. */
'use strict';
const signingBytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const signingBase64 = value => btoa(Array.from(new Uint8Array(value), b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const signingCanonical = value => JSON.stringify((function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
  return v;
})(value));
const languages = ['en', 'vi', 'ru'];
const languageIndex = code => {
  const i = languages.indexOf(code);
  return i >= 0 ? i : 0;
};
let activeLanguage = typeof navigator === 'undefined' ? 'en' : (navigator.language || 'en').split('-')[0];
if (!languages.includes(activeLanguage)) activeLanguage = 'en';
const aloc = text => {
  const parts = text.split('|');
  return parts[languageIndex(activeLanguage)] || parts[0];
};
const authorizationChallenge = async (challenge, credentialId, publicKey) => signingBase64(await crypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(`authorize:${challenge}:${signingCanonical({ credentialId, publicKey })}`),
));
const compactRequestUrl = async url => {
  const parsed = new URL(url);
  const encoded = new URLSearchParams(parsed.hash.slice(1)).get('request');
  if (!encoded || encoded.length > 2000000 || typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([signingBytes(encoded)]).stream().pipeThrough(new CompressionStream('gzip'));
  const packed = signingBase64(await new Response(stream).arrayBuffer());
  parsed.hash = `packed=${packed}`;
  return parsed.href;
};
const readRequestFragment = async hash => {
  const params = new URLSearchParams(hash.slice(1));
  const encoded = params.get('request');
  const packed = params.get('packed');
  if ((encoded === null) === (packed === null) || (encoded || packed).length > 2000000) {
    throw Error(aloc('Missing or oversized invitation.|Lời mời bị thiếu hoặc quá lớn.|Приглашение отсутствует или слишком велико.'));
  }
  if (encoded !== null) return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(signingBytes(encoded)));
  if (typeof DecompressionStream === 'undefined') throw Error('This browser cannot read the compressed invitation.');
  const reader = new Blob([signingBytes(packed)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 2000000) {
      await reader.cancel();
      throw Error(aloc('Invitation is too large.|Lời mời quá lớn.|Приглашение слишком велико.'));
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
};
const buildStaticViewerUrl = (request, signingPageUrl) => {
  if (!request?.document || typeof request.document !== 'object' || Array.isArray(request.document)) return null;
  // The signing invitation is bound to the server's operational document.
  // The viewer gets only that document, never signer rows or evidence.
  const { signs, signGroups, fullSimopsSignSnapshot, links, ...set } = request.document;
  const viewerSet = { ...set, createdBy: 1, updatedBy: 1, status: 2, signs: [], signGroups: [] };
  const viewerUrl = new URL('./', signingPageUrl);
  viewerUrl.hash = `d=${signingBase64(new TextEncoder().encode(JSON.stringify({ set: viewerSet })))}&transient=1`;
  return viewerUrl.href;
};
const slugName = value => String(value || '')
  .normalize('NFKD')
  .replace(/[^\w.-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48)
  .toLowerCase() || 'user';
const isPhoneBrowser = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  return false;
};
if (typeof module !== 'undefined') module.exports = { signingBytes, signingBase64, signingCanonical, aloc, authorizationChallenge, compactRequestUrl, readRequestFragment, buildStaticViewerUrl, slugName, isPhoneBrowser };

if (typeof document !== 'undefined') (async () => {
  const element = id => document.getElementById(id);
  const language = element('language');
  if (language) language.value = activeLanguage;
  const translateStatic = () => {
    document.documentElement.lang = activeLanguage;
    document.title = aloc('SIMOPS secure signing|Ký SIMOPS an toàn|Безопасное подписание SIMOPS');
    document.querySelectorAll('[data-aloc]').forEach(el => { el.textContent = aloc(el.dataset.aloc); });
  };
  translateStatic();
  let request, responseFile, expires;
  let busy = false;
  let androidMode = false;
  let refreshDynamic = () => {};
  const onPhone = isPhoneBrowser();

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(responseFile, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `simops-${request.kind}-${request.requestId}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const deliverResponse = () => {
    if (request.returnOrigin && window.opener && new URL(request.returnOrigin).origin === request.returnOrigin) {
      window.opener.postMessage(JSON.stringify({ type: 'simops-passkey-response', response: responseFile }), request.returnOrigin);
      element('status').textContent = aloc(
        'Response sent to SIMOPS for verification. Return to the application for the result.|Đã gửi phản hồi tới SIMOPS để xác minh. Quay lại ứng dụng để xem kết quả.|Ответ передан в SIMOPS на проверку. Вернитесь в приложение за результатом.',
      );
    } else {
      download();
      element('status').textContent = aloc(
        'Response downloaded. Return the JSON to your SIMOPS coordinator. It remains pending verification.|Đã tải phản hồi. Gửi JSON cho điều phối viên SIMOPS. Phản hồi đang chờ xác minh.|Ответ скачан. Передайте JSON координатору SIMOPS. Он ожидает проверки.',
      );
    }
    element('download').hidden = false;
  };

  const renderSummary = () => {
    const name = (request.signerName || '').trim();
    const position = (request.signerPosition || '').trim();
    const email = (request.signerEmail || '').trim();
    const lines = [
      name || `${aloc('Employee|Nhân viên|Сотрудник')} #${request.signerId}`,
      position,
      email,
      `${aloc('Expires|Hết hạn|Действует до')} ${new Date(expires).toLocaleString()}`,
    ].filter(Boolean);
    element('summary').textContent = lines.join('\n');
  };

  const probeSimops = async () => {
    const note = element('simopsLink');
    if (!note) return;
    if (!request?.returnOrigin || typeof fetch !== 'function') {
      note.hidden = true;
      return;
    }
    note.hidden = false;
    note.className = 'note muted';
    note.textContent = aloc(
      'Checking whether the SIMOPS app that opened this page is still reachable…|Đang kiểm tra ứng dụng SIMOPS đã mở trang này còn truy cập được không…|Проверяем, доступно ли ещё приложение SIMOPS, открывшее эту страницу…',
    );
    const supportsAbort = typeof AbortController === 'function';
    const controller = supportsAbort ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), 2500);
    try {
      await fetch(request.returnOrigin, {
        mode: 'no-cors',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      clearTimeout(timer);
      note.className = 'note ok';
      note.textContent = aloc(
        'SIMOPS app origin looks reachable. After confirmation, keep that window open so the result can return automatically.|Nguồn ứng dụng SIMOPS có vẻ truy cập được. Sau khi xác nhận, giữ cửa sổ đó mở để kết quả tự gửi về.|Источник приложения SIMOPS доступен. После подтверждения оставьте окно открытым, чтобы результат вернулся автоматически.',
      );
    } catch {
      clearTimeout(timer);
      note.className = 'note warn';
      note.textContent = aloc(
        'Cannot reach the SIMOPS app from here right now. You can still confirm the passkey, then download the JSON and import it in SIMOPS later.|Hiện không tới được ứng dụng SIMOPS từ đây. Bạn vẫn có thể xác nhận passkey, rồi tải JSON và nhập vào SIMOPS sau.|Сейчас приложение SIMOPS недоступно. Вы всё равно можете подтвердить ключ, затем скачать JSON и импортировать его в SIMOPS позже.',
      );
    }
  };

  const renderAndroidQr = async () => {
    const url = location.href;
    const box = element('androidQr');
    const urlEl = element('androidUrl');
    if (!box) return;
    const makeQr = value => {
      if (typeof qrcode !== 'function') return null;
      try {
        const qr = qrcode(0, 'M');
        qr.addData(value);
        qr.make();
        return qr.createImgTag(5, 8);
      } catch {
        return null;
      }
    };
    let qrUrl = url;
    // A level-M QR cannot hold a long URL; avoid building a huge symbol first.
    let image = url.length <= 2300 ? makeQr(qrUrl) : null;
    if (!image) {
      try {
        const compact = await compactRequestUrl(url);
        if (compact) {
          const compactImage = compact.length <= 2300 ? makeQr(compact) : null;
          if (compactImage) { qrUrl = compact; image = compactImage; }
        }
      } catch { /* The full link remains available below. */ }
    }
    if (urlEl) urlEl.textContent = qrUrl;
    if (image) { box.innerHTML = image; return; }
    box.textContent = typeof qrcode === 'function'
      ? aloc('This invitation is too large for one QR code. Copy the link below into Chrome on Android.|Lời mời quá lớn cho một mã QR. Sao chép liên kết bên dưới vào Chrome trên Android.|Приглашение слишком велико для одного QR-кода. Скопируйте ссылку ниже в Chrome на Android.')
      : aloc('QR generator unavailable. Copy the link below into Chrome on Android.|Không có trình tạo QR. Sao chép liên kết bên dưới vào Chrome trên Android.|Генератор QR недоступен. Скопируйте ссылку ниже в Chrome на Android.');
  };

  if (language) {
    language.addEventListener('change', () => {
      activeLanguage = language.value;
      translateStatic();
      refreshDynamic();
    });
  }

  try {
    if (!isSecureContext || !navigator.credentials || !window.PublicKeyCredential) {
      throw Error(aloc('Open this page over HTTPS in a browser with passkey support.|Mở trang này qua HTTPS bằng trình duyệt hỗ trợ passkey.|Откройте страницу по HTTPS в браузере с поддержкой ключей доступа.'));
    }
    request = await readRequestFragment(location.hash);
    if (request.v !== 1 || !['enroll', 'approve', 'add', 'replace', 'remove', 'recover', 'login'].includes(request.kind) || request.origin !== location.origin || request.rpId !== location.hostname) {
      throw Error(aloc('This invitation belongs to another signing site.|Lời mời này thuộc trang ký khác.|Это приглашение предназначено для другого сайта.'));
    }
    expires = Date.parse(request.expiresAt);
    if (!Number.isFinite(expires) || Date.now() >= expires) {
      throw Error(aloc('Invitation expired. Start again in SIMOPS.|Lời mời hết hạn. Bắt đầu lại trong SIMOPS.|Срок приглашения истёк. Начните заново в SIMOPS.'));
    }
    const { challenge, ...boundRequest } = request;
    if (signingBase64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signingCanonical(boundRequest)))) !== challenge) {
      throw Error(aloc('Invitation content was changed. Start again in SIMOPS.|Nội dung lời mời đã bị thay đổi. Bắt đầu lại trong SIMOPS.|Содержимое приглашения изменено. Начните заново в SIMOPS.'));
    }
    const selfService = request.flow === 'selfService';
    const adding = ['enroll', 'add', 'replace', 'recover'].includes(request.kind);
    const requiresEula = ['enroll', 'add', 'replace', 'recover'].includes(request.kind);
    const needsExistingOnSameDevice = selfService && ['add', 'replace', 'recover'].includes(request.kind);
    const explanations = {
      login: 'Sign in to your approved external account with your passkey. This does not approve any SIMOPS. Each document requires a separate passkey confirmation.|Đăng nhập tài khoản bên ngoài đã được phê duyệt bằng passkey. Thao tác này không phê duyệt SIMOPS. Mỗi tài liệu cần xác nhận riêng bằng passkey.|Войдите в согласованную внешнюю учётную запись ключом доступа. Это не подписывает SIMOPS. Для каждого документа требуется отдельное подтверждение ключом.',
      enroll: selfService
        ? 'Register your first passkey on this device (Windows Hello on PC, or fingerprint/PIN on Android). Prefer this PC when the link was opened here. To use Android instead, scan the QR — no Bluetooth.|Đăng ký passkey đầu tiên trên thiết bị này (Windows Hello trên PC, hoặc vân tay/PIN trên Android). Nên dùng PC này nếu đã mở liên kết tại đây. Muốn dùng Android, quét QR — không cần Bluetooth.|Зарегистрируйте первый ключ на этом устройстве (Windows Hello на ПК или отпечаток/PIN на Android). Предпочтительнее этот ПК, если ссылка открыта здесь. Для Android отсканируйте QR — Bluetooth не нужен.'
        : 'Register your passkey. SIMOPS staff will independently verify your identity and authority. This does not approve a document.|Đăng ký passkey. Nhân viên SIMOPS sẽ xác minh riêng danh tính và quyền ký. Thao tác này không phê duyệt tài liệu.|Зарегистрируйте ключ. Сотрудник SIMOPS отдельно проверит вашу личность и полномочия. Это не подписывает документ.',
      add: 'Authorize with an existing passkey on this same device, then create another. To use Android, that phone must already hold an allowed passkey — or stay on this PC.|Xác nhận bằng passkey hiện có trên cùng thiết bị, rồi tạo khóa khác. Để dùng Android, điện thoại phải đã có passkey được phép — hoặc tiếp tục trên PC.|Подтвердите действующим ключом на том же устройстве, затем создайте ещё один. Для Android на телефоне уже должен быть разрешённый ключ — или оставайтесь на ПК.',
      replace: 'Authorize with an existing passkey on this same device, then create its replacement. The old public key will be retained.|Xác nhận bằng passkey hiện có trên cùng thiết bị, rồi tạo khóa thay thế. Khóa công khai cũ sẽ được lưu giữ.|Подтвердите действующим ключом на том же устройстве и создайте замену. Старый открытый ключ будет сохранён.',
      remove: 'Authorize removal with an existing passkey. Removing your last key requires administrator recovery for future secure signing. Historical signatures remain verifiable.|Xác nhận xóa bằng passkey hiện có. Nếu xóa khóa cuối cùng, cần quản trị viên khôi phục để ký an toàn sau này. Chữ ký cũ vẫn có thể xác minh.|Подтвердите удаление действующим ключом. После удаления последнего ключа понадобится восстановление администратором. Старые подписи останутся проверяемыми.',
      recover: 'Administrator: verify the employee identity and authority, authorize recovery with your own passkey, then let the employee create their new passkey. Previous keys will be revoked and retained.|Quản trị viên: xác minh danh tính và quyền của nhân viên, cho phép khôi phục bằng passkey của bạn, sau đó để nhân viên tạo passkey mới. Khóa cũ sẽ bị thu hồi và lưu giữ.|Администратор: проверьте личность и полномочия сотрудника, подтвердите восстановление своим ключом, затем сотрудник создаст новый ключ. Старые ключи будут отозваны и сохранены.',
      approve: 'I have reviewed the complete SIMOPS document and approve it.|Tôi đã xem toàn bộ tài liệu SIMOPS và phê duyệt.|Я ознакомился с полным документом SIMOPS и одобряю его.',
    };

    const updateChrome = () => {
      const pcActions = element('pcActions');
      const androidPanel = element('androidPanel');
      const createDevice = element('createDevice');
      const openAndroid = element('openAndroid');
      const confirm = element('confirm');
      if (androidPanel) androidPanel.hidden = !androidMode || onPhone;
      if (pcActions) pcActions.hidden = onPhone || androidMode;
      if (createDevice) createDevice.hidden = !adding;
      if (confirm) confirm.hidden = androidMode || (!onPhone && adding);
      if (openAndroid) openAndroid.hidden = onPhone;
    };

    refreshDynamic = () => {
      renderSummary();
      element('consent').textContent = aloc(explanations[request.kind]);
      const confirmLabel = request.kind === 'login'
        ? 'Sign in with passkey|Đăng nhập bằng passkey|Войти с ключом'
        : request.kind === 'approve'
          ? 'Secure sign|Ký an toàn|Подписать безопасно'
          : adding
            ? 'Create passkey on this device|Tạo passkey trên thiết bị này|Создать ключ на этом устройстве'
            : 'Confirm with passkey|Xác nhận bằng passkey|Подтвердить ключом';
      element('confirm').textContent = aloc(confirmLabel);
      if (element('createDevice')) {
        element('createDevice').textContent = aloc(
          'Continue on this PC (Windows Hello)|Tiếp tục trên PC này (Windows Hello)|Продолжить на этом ПК (Windows Hello)',
        );
      }
      if (element('openAndroid')) {
        element('openAndroid').textContent = aloc(
          'Use Android instead (scan QR)|Dùng Android (quét QR)|Использовать Android (сканировать QR)',
        );
      }
      if (element('androidHelp')) {
        element('androidHelp').textContent = needsExistingOnSameDevice
          ? aloc(
            'Scan with the Android camera to open this same request in Chrome. Finish the passkey on the phone (existing key must already be on that phone), download JSON, then import it below. Bluetooth is not used.|Quét bằng camera Android để mở cùng yêu cầu trong Chrome. Hoàn tất passkey trên điện thoại (khóa hiện có phải đã có trên máy đó), tải JSON, rồi nhập bên dưới. Không dùng Bluetooth.|Отсканируйте камерой Android, чтобы открыть тот же запрос в Chrome. Завершите ключ на телефоне (действующий ключ уже должен быть на нём), скачайте JSON и импортируйте ниже. Bluetooth не используется.',
          )
          : aloc(
            'Scan with the Android camera to open this same request in Chrome. Finish the passkey on the phone, download JSON, then import it below. Bluetooth is not used.|Quét bằng camera Android để mở cùng yêu cầu trong Chrome. Hoàn tất passkey trên điện thoại, tải JSON, rồi nhập bên dưới. Không dùng Bluetooth.|Отсканируйте камерой Android, чтобы открыть тот же запрос в Chrome. Завершите ключ на телефоне, скачайте JSON и импортируйте ниже. Bluetooth не используется.',
          );
      }
      updateChrome();
      void probeSimops();
    };
    refreshDynamic();

    const viewerUrl = buildStaticViewerUrl(request, location.href);
    if (viewerUrl) {
      element('document').hidden = false;
      element('simopsViewer').src = viewerUrl;
      element('openSimopsViewer').href = viewerUrl;
    }

    element('reviewed').disabled = false;
    if (element('eulaRow')) element('eulaRow').hidden = !requiresEula;
    if (element('eula')) element('eula').disabled = !requiresEula;
    const setActionEnabled = () => {
      const eulaOk = !requiresEula || (element('eula') && element('eula').checked);
      const ready = !busy && element('reviewed').checked && eulaOk && !responseFile;
      element('confirm').disabled = !ready;
      if (element('createDevice')) element('createDevice').disabled = !ready;
      if (element('openAndroid')) element('openAndroid').disabled = !ready;
      if (element('importJson')) element('importJson').disabled = !!responseFile || busy;
      updateChrome();
    };
    element('reviewed').addEventListener('change', setActionEnabled);
    if (element('eula')) element('eula').addEventListener('change', setActionEnabled);
    element('download').addEventListener('click', download);
    setActionEnabled();

    const getAssertion = async (challengeValue, ids) => {
      if (!ids.length) throw Error(aloc('No registered passkey is available.|Không có passkey đã đăng ký.|Нет зарегистрированного ключа.'));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: signingBytes(challengeValue),
          rpId: request.rpId,
          allowCredentials: ids.map(id => ({ type: 'public-key', id: signingBytes(id) })),
          userVerification: 'required',
          timeout: 120000,
        },
      });
      if (!assertion) throw Error(aloc('Passkey confirmation was cancelled.|Đã hủy xác nhận passkey.|Подтверждение ключом отменено.'));
      return {
        credentialId: signingBase64(assertion.rawId),
        clientDataJSON: signingBase64(assertion.response.clientDataJSON),
        authenticatorData: signingBase64(assertion.response.authenticatorData),
        signature: signingBase64(assertion.response.signature),
        userHandle: assertion.response.userHandle ? signingBase64(assertion.response.userHandle) : null,
      };
    };

    const webauthnUser = () => {
      const name = (request.signerName || '').trim();
      const email = (request.signerEmail || '').trim();
      const account = `simops-${slugName(name || email || request.signerId)}-${request.signerId}`;
      const display = [name, request.signerPosition, email].map(s => String(s || '').trim()).filter(Boolean).join(' · ')
        || `SIMOPS #${request.signerId}`;
      return {
        id: new TextEncoder().encode(`simops:${request.signerId}`),
        name: account,
        displayName: display,
      };
    };

    const createPasskey = async () => {
      element('status').textContent = aloc(
        'Create your passkey, then confirm possession when prompted.|Tạo passkey, sau đó xác nhận quyền sở hữu khi được yêu cầu.|Создайте ключ и подтвердите владение им при запросе.',
      );
      const publicKey = {
        challenge: signingBytes(request.challenge),
        rp: { id: request.rpId, name: 'SIMOPS' },
        user: webauthnUser(),
        excludeCredentials: (request.excludeCredentialIds || []).map(id => ({ type: 'public-key', id: signingBytes(id) })),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        attestation: 'none',
        timeout: 120000,
        hints: ['client-device'],
      };
      const created = await navigator.credentials.create({ publicKey });
      if (!created?.response) {
        throw Error(aloc('Passkey was not created.|Passkey chưa được tạo.|Ключ не создан.'));
      }
      if (typeof created.response.getPublicKey !== 'function' || created.response.getPublicKeyAlgorithm() !== -7) {
        throw Error(aloc(
          'This authenticator did not return an ES256 public key. Prefer Windows Hello on this PC, or open this page on Android via the QR and create the key there.|Trình xác thực không trả khóa công khai ES256. Nên dùng Windows Hello trên PC này, hoặc mở trang trên Android qua QR và tạo khóa tại đó.|Аутентификатор не вернул открытый ключ ES256. Предпочтительнее Windows Hello на этом ПК или откройте страницу на Android по QR и создайте ключ там.',
        ));
      }
      return created;
    };

    const finish = async () => {
      busy = true;
      setActionEnabled();
      try {
        if (Date.now() >= expires) throw Error(aloc('Invitation expired.|Lời mời hết hạn.|Срок приглашения истёк.'));
        let authorization;
        let credentialId = request.credentialId;
        let publicKey;
        let registration;
        if (adding) {
          element('status').textContent = aloc(
            'Create your passkey on this device (Windows Hello / fingerprint / PIN).|Tạo passkey trên thiết bị này (Windows Hello / vân tay / PIN).|Создайте ключ на этом устройстве (Windows Hello / отпечаток / PIN).',
          );
          const created = await createPasskey();
          credentialId = signingBase64(created.rawId);
          const key = await crypto.subtle.importKey('spki', created.response.getPublicKey(), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
          publicKey = await crypto.subtle.exportKey('jwk', key);
          const fingerprint = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([4, ...signingBytes(publicKey.x), ...signingBytes(publicKey.y)]))),
            b => b.toString(16).padStart(2, '0'),
          ).join('');
          const text = document.createElement('p');
          text.textContent = `${aloc('Key fingerprint|Dấu vân tay khóa|Отпечаток ключа')} (SHA-256): ${fingerprint}`;
          element('summary').append(text);
          registration = {
            clientDataJSON: signingBase64(created.response.clientDataJSON),
            attestationObject: signingBase64(created.response.attestationObject),
          };
          element('status').textContent = aloc(
            'Confirm possession of the new passkey when prompted.|Xác nhận quyền sở hữu passkey mới khi được yêu cầu.|Подтвердите владение новым ключом при запросе.',
          );
        }
        if (needsExistingOnSameDevice) {
          element('status').textContent = aloc(
            'Authorize this exact new key with your existing passkey.|Dùng passkey hiện có để cho phép khóa mới này.|Подтвердите именно этот новый ключ действующим ключом.',
          );
          authorization = await getAssertion(
            await authorizationChallenge(request.challenge, credentialId, publicKey), request.credentialIds,
          );
        }
        responseFile = {
          v: 1,
          requestId: request.requestId,
          ...await getAssertion(request.challenge, adding ? [credentialId] : request.credentialIds || [credentialId]),
          ...(publicKey ? { publicKey, registration } : {}),
          ...(authorization ? { authorization } : {}),
        };
        deliverResponse();
      } catch (error) {
        const cancelled = error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
        element('status').textContent = cancelled
          ? aloc('Passkey operation cancelled or timed out.|Thao tác passkey bị hủy hoặc hết thời gian.|Операция с ключом отменена или время ожидания истекло.')
          : (error && error.message) || String(error);
      } finally {
        busy = false;
        setActionEnabled();
      }
    };

    const openAndroidPanel = () => {
      androidMode = true;
      void renderAndroidQr();
      element('status').textContent = aloc(
        'Scan the QR on Android, finish there, then import the downloaded JSON here.|Quét QR trên Android, hoàn tất tại đó, rồi nhập JSON đã tải tại đây.|Отсканируйте QR на Android, завершите там, затем импортируйте скачанный JSON здесь.',
      );
      setActionEnabled();
    };

    const closeAndroidPanel = () => {
      androidMode = false;
      element('status').textContent = '';
      setActionEnabled();
    };

    const importPhoneJson = async file => {
      if (!file || responseFile) return;
      busy = true;
      setActionEnabled();
      try {
        const parsed = JSON.parse(await file.text());
        if (parsed?.v !== 1 || parsed.requestId !== request.requestId) {
          throw Error(aloc(
            'This JSON does not match the current invitation.|JSON này không khớp lời mời hiện tại.|Этот JSON не соответствует текущему приглашению.',
          ));
        }
        if (!parsed.credentialId || !parsed.clientDataJSON || !parsed.authenticatorData || !parsed.signature) {
          throw Error(aloc('JSON is missing passkey assertion fields.|JSON thiếu trường xác nhận passkey.|В JSON нет полей подтверждения ключа.'));
        }
        if (adding && (!parsed.publicKey || !parsed.registration)) {
          throw Error(aloc('JSON is missing the new passkey registration.|JSON thiếu đăng ký passkey mới.|В JSON нет регистрации нового ключа.'));
        }
        responseFile = parsed;
        deliverResponse();
      } catch (error) {
        element('status').textContent = (error && error.message) || String(error);
      } finally {
        busy = false;
        setActionEnabled();
      }
    };

    element('confirm').addEventListener('click', () => finish());
    if (element('createDevice')) element('createDevice').addEventListener('click', () => finish());
    if (element('openAndroid')) element('openAndroid').addEventListener('click', openAndroidPanel);
    if (element('copyAndroidUrl')) {
      element('copyAndroidUrl').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(element('androidUrl').textContent);
          element('status').textContent = aloc('Link copied.|Đã sao chép liên kết.|Ссылка скопирована.');
        } catch {
          element('status').textContent = aloc('Select and copy the link above.|Chọn và sao chép liên kết ở trên.|Выделите и скопируйте ссылку выше.');
        }
      });
    }
    if (element('backToPc')) element('backToPc').addEventListener('click', closeAndroidPanel);
    if (element('importJson')) {
      element('importJson').addEventListener('change', event => {
        const file = event.target.files && event.target.files[0];
        void importPhoneJson(file);
        event.target.value = '';
      });
    }
  } catch (error) {
    element('summary').textContent = error.message || String(error);
  }
})();
