(() => {
  const overlay = new URLSearchParams(location.search).get('obs') === '1';
  let dialog;
  let loginPending;
  let finishLogin;

  function showLogin() {
    if (overlay) return Promise.resolve(false);
    if (loginPending) return loginPending;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.style.cssText = 'margin:auto;padding:24px;max-width:480px;width:90%;background:#210906;color:#fff8eb;border:1px solid #f4c150;border-radius:12px';
      const form = document.createElement('form');
      const title = document.createElement('h2');
      title.textContent = 'Đăng nhập quản trị';
      const description = document.createElement('p');
      description.textContent = 'Nhập mã quản trị hiển thị trong terminal khi khởi động app. Phiên đăng nhập có hiệu lực 8 giờ.';
      const input = document.createElement('input');
      input.type = 'password'; input.autocomplete = 'off'; input.required = true;
      input.placeholder = 'Mã quản trị'; input.maxLength = 128;
      input.style.cssText = 'width:100%;padding:10px;margin:12px 0';
      const error = document.createElement('p');
      error.setAttribute('role', 'status');
      const submit = document.createElement('button');
      submit.type = 'submit'; submit.textContent = 'Đăng nhập';
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.textContent = 'Hủy'; cancel.style.marginLeft = '12px';
      cancel.addEventListener('click', () => dialog.close());
      form.append(title, description, input, error, submit, cancel);
      dialog.append(form); document.body.append(dialog);
      form.addEventListener('submit', async event => {
        event.preventDefault(); submit.disabled = true;
        try {
          const res = await fetch('/api/session', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: input.value }) });
          const data = await res.json();
          input.value = '';
          if (!res.ok) { error.textContent = data.error || 'Không thể đăng nhập'; return; }
          finishLogin?.(true); finishLogin = null; dialog.close();
        } catch { error.textContent = 'Không thể kết nối server'; }
        finally { submit.disabled = false; }
      });
      dialog.addEventListener('close', () => {
        input.value = ''; error.textContent = '';
        finishLogin?.(false); finishLogin = null; loginPending = null;
      });
    }
    loginPending = new Promise(resolve => { finishLogin = resolve; });
    dialog.showModal();
    return loginPending;
  }

  window.templeRpc = async (method, params = {}) => {
    if (overlay) return { error: { message: 'Overlay chỉ nhận sự kiện' } };
    const send = () => fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) });
    try {
      let res = await send();
      if (res.status === 401 && await showLogin()) res = await send();
      const data = await res.json();
      if (!res.ok && !data.error?.message) return { error: { message: typeof data.error === 'string' ? data.error : 'Lệnh bị từ chối' } };
      return data;
    } catch { return { error: { message: 'Không thể kết nối server' } }; }
  };

  if (!overlay) {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:8px;right:8px;z-index:10000;display:flex;gap:8px';
    const login = document.createElement('button');
    login.textContent = 'Đăng nhập quản trị'; login.addEventListener('click', showLogin);
    const logout = document.createElement('button');
    logout.textContent = 'Đăng xuất';
    logout.addEventListener('click', async () => {
      const res = await fetch('/api/session', { method: 'DELETE' });
      logout.textContent = res.ok ? 'Đã đăng xuất' : 'Chưa đăng nhập';
    });
    bar.append(login, logout); document.body.append(bar);
  }
})();
