async function sendRpc(method, extraParams = {}) {
  const user = document.getElementById('rpcUser').value.trim() || 'Thí Chủ';
  const wish = document.getElementById('rpcWish').value.trim();
  const data = await window.templeRpc(method, { user, wish, ...extraParams });
  document.getElementById('rpcOutput').textContent = JSON.stringify(data, null, 2);
  refreshStatus();
  return data;
}

document.getElementById('btnConn').onclick = () => {
  const username = document.getElementById('ttUser').value.trim();
  sendRpc('live.connect', { username });
};
document.getElementById('btnDisc').onclick = () => sendRpc('live.disconnect', {});
document.getElementById('btnSendComment').onclick = () => {
  const comment = document.getElementById('simComment').value.trim();
  sendRpc('temple.comment', { comment });
};
document.getElementById('btnSpeakMaiChi').onclick = async () => {
  const text = document.getElementById('ttsDirectText').value.trim();
  const data = await sendRpc('temple.speak', { text, voice: 'maichi', broadcast: true });
  if (data?.result?.url) {
    const player = document.getElementById('adminAudioPreview');
    player.src = data.result.url;
    player.play().catch(() => {});
  }
};

async function refreshStatus() {
  const res = await fetch('/api/state');
  const st = await res.json();
  document.getElementById('statusBanner').textContent =
    `Hương đã thắp: ${st.totalIncense} | Tổng Công Đức: ${st.totalMerit} | ZeroTTS: ${st.tts?.status} (Giọng: ${st.tts?.voice})`;
}
refreshStatus();
setInterval(refreshStatus, 4000);

document.getElementById('action0').addEventListener('click', () => sendRpc('temple.burnIncense', { count: 3 }));
document.getElementById('action1').addEventListener('click', () => sendRpc('temple.sendPrayer', {}));
document.getElementById('action2').addEventListener('click', () => sendRpc('temple.strikeWoodenFish', { count: 9 }));
document.getElementById('action3').addEventListener('click', () => sendRpc('temple.ringBell', { count: 1, readTts: true }));
document.getElementById('action4').addEventListener('click', () => sendRpc('temple.drawFortune', {}));
document.getElementById('action5').addEventListener('click', () => sendRpc('temple.offerGift', { giftType: 'fruit', coins: 30, giftName: 'Mâm Ngũ Quả Cát Tường' }));
document.getElementById('action6').addEventListener('click', () => sendRpc('temple.grandCeremony', { coins: 500, giftName: 'Đại Lễ Kim Long Chầu Phật' }));
document.getElementById('action7').addEventListener('click', () => sendRpc('temple.resetMerit', {}));
