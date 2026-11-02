'use strict';
// Simulated worshippers. Names and ids look like ordinary TikTok accounts; wishes are
// short, varied and in the voice of real comments. Nothing here is persisted.
const NPC_POOL = Object.freeze([
  ['Ngọc Anh Nguyễn', 'ngocanh.98'], ['Trần Minh Quân', 'minhquan_bds'], ['Diệu Thảo Tâm An', 'tam_an_99'],
  ['Lê Hoàng Nam', 'hoangnam.dev'], ['Phạm Thanh Hà', 'thanhha.lotus'], ['Vũ Đức Thịnh', 'ducthinh88'],
  ['Hồng Nhung', 'hongnhung.sg'], ['Bảo Châu', 'baochau_09'], ['Thiện Tâm', 'thientam.vn'], ['Minh Khôi', 'minhkhoi.dn'],
  ['Phương Linh', 'phuonglinh.hn'], ['An Nhiên', 'annhien_2k'], ['Quốc Bảo', 'quocbao.hue'], ['Tuệ Minh', 'tueminh.lotus'],
  ['Kim Ngân', 'kimngan.ct'], ['Gia Hân', 'giahan_88'], ['Đức Huy', 'duchuy.qn'], ['Thu Trang', 'thutrang.bd'],
  ['Mai Anh', 'maianh.hp'], ['Hoàng Long', 'hoanglong_1995'], ['Thanh Tùng', 'tungthanh.vt'], ['Bích Ngọc', 'bichngoc.2003'],
  ['Cẩm Tú', 'camtu_lotus'], ['Văn Hiếu', 'vanhieu.ntl'], ['Khánh Vy', 'khanhvy.official'], ['Anh Thư', 'anhthu.dalat'],
  ['Hải Đăng', 'haidang_89'], ['Tâm Như', 'tamnhu.an'], ['Lan Hương', 'lanhuong.nb'], ['Quang Vinh', 'quangvinh.bt'],
  ['Thúy Hằng', 'thuyhang_79'], ['Minh Châu', 'minhchau.cm'], ['Việt Anh', 'vietanh.tg'], ['Hạnh Phúc', 'hanhphuc.vn'],
  ['Ngọc Lan', 'ngoclan.bh'], ['Tiến Dũng', 'tiendung.tn'], ['Diệp Anh', 'diepanh_97'], ['Phúc An', 'phucan.bmt'],
  ['Thảo Nguyên', 'thaonguyen.ag'], ['Trung Kiên', 'trungkien.bg'], ['Như Quỳnh', 'nhuquynh.vl'], ['Đăng Khoa', 'dangkhoa_2k1'],
  ['Mỹ Linh', 'mylinh.ln'], ['Sơn Tùng', 'sontung.ph'], ['Hoài Thương', 'hoaithuong.kg'], ['Gia Bảo', 'giabao.sg07'],
  ['Thanh Mai', 'thanhmai.tv'], ['Công Thành', 'congthanh.yb'], ['Lệ Quyên', 'lequyen.nd'], ['Xuân Mai', 'xuanmai_85'],
  ['Hồng Phúc', 'hongphuc.dl'], ['Tường Vy', 'tuongvy.bn'], ['Anh Khoa', 'anhkhoa.dt'], ['Ngân Hà', 'nganha.st'],
  ['Phước Lộc', 'phuocloc.tr'], ['Yến Nhi', 'yennhi_lotus'], ['Duy Khánh', 'duykhanh.th'], ['Kiều Oanh', 'kieuoanh.hy'],
  ['Thiện Nhân', 'thiennhan.cb'], ['Mộc Miên', 'mocmien.qb']
].map(([user, uniqueId]) => Object.freeze({ user, uniqueId })));

// More accounts built from common Vietnamese family/middle/given names, so a long stream does not recycle the same few.
const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const DEM = ['Minh', 'Ngọc', 'Thanh', 'Gia', 'Anh', 'Bảo', 'Hữu', 'Đức', 'Quốc', 'Tuệ', 'Phương', 'Thiện'];
const TEN = ['An', 'Bình', 'Châu', 'Dũng', 'Giang', 'Hà', 'Hải', 'Hạnh', 'Hiền', 'Hoa', 'Hùng', 'Huy', 'Khánh', 'Lam', 'Linh', 'Loan', 'Long',
  'Mận', 'My', 'Nga', 'Nhàn', 'Phát', 'Phong', 'Phúc', 'Quyên', 'Sương', 'Tài', 'Thảo', 'Thịnh', 'Trang', 'Trinh', 'Tuấn', 'Vân', 'Yến', 'Lộc', 'Tâm'];
const SUFFIX = ['', '', '', '.vn', '_96', '.sg', '99', '_2k', '.hn', '.official', '88', '.dn'];
const ascii = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

function buildGeneratedPool(count = 240) {
  const taken = new Set(NPC_POOL.map(n => n.uniqueId));
  const out = [];
  for (let i = 0; out.length < count && i < 5000; i++) {
    // Fixed strides keep the list deterministic while mixing combinations.
    const ho = HO[(i * 7) % HO.length], dem = DEM[(i * 5 + 3) % DEM.length], ten = TEN[(i * 11 + 1) % TEN.length];
    const full = i % 3 === 0 ? `${dem} ${ten}` : `${ho} ${dem} ${ten}`;
    const id = ascii(`${ten}${i % 2 ? '.' : '_'}${dem}${SUFFIX[(i * 3) % SUFFIX.length]}`).replace(/\s+/g, '');
    if (taken.has(id)) continue;
    taken.add(id);
    out.push(Object.freeze({ user: full, uniqueId: id }));
  }
  return out;
}
const NPC_ALL = Object.freeze([...NPC_POOL, ...buildGeneratedPool()]);

// A shuffled bag: every wish is used once before any repeats, and a wish never comes back right away.
function createWishDeck(wishes, random = Math.random) {
  let bag = [], last = null;
  return {
    next() {
      if (!bag.length) {
        bag = wishes.slice();
        for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
        if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
      last = bag.pop();
      return last;
    }
  };
}

const NPC_WISHES = Object.freeze([
  'Con thành tâm cầu cho bố mẹ luôn mạnh khỏe, bình an',
  'Cầu tháng mới công việc thuận buồm xuôi gió, tài lộc hanh thông',
  'Nam Mô A Di Đà Phật, nguyện cầu thế giới hòa bình chúng sinh an lạc',
  'Cầu cho con học hành tiến bộ, sự nghiệp rộng mở',
  'Cầu gia đạo êm ấm, con cái ngoan ngoãn học giỏi',
  'Con xin gieo một quẻ cầu tài lộc bình an',
  'Cầu cho ông bà nội ngoại sức khỏe dồi dào',
  'Xin Phật gia hộ cho con qua kỳ phỏng vấn tuần này',
  'Cầu cho bé nhà con ăn ngoan chóng lớn, không ốm vặt',
  'Mong việc làm ăn buôn bán dạo này được thuận lợi',
  'Cầu cho người thân đang bệnh sớm bình phục',
  'Xin cho con tìm được người bạn đời hiền lành tử tế',
  'Cầu bình an cho cả nhà, đi đường xa được thuận lợi',
  'Con xin sám hối những lỗi lầm đã qua, nguyện sống thiện lành',
  'Cầu cho mẹ con khỏi bệnh, con sẽ làm nhiều việc thiện',
  'Nguyện cầu mọi người đều mạnh khỏe, bình an',
  'Xin cho con vượt qua giai đoạn khó khăn này',
  'Cầu cho công ty ổn định, anh em đều có việc làm',
  'Con cầu cho em gái học hành chăm ngoan, tương lai sáng sủa',
  'Mong tâm con được bình yên, bớt lo âu phiền muộn',
  'Cầu cho chồng con làm ăn xa được bình an trở về',
  'Xin Phật từ bi gia hộ cho gia đình con hòa thuận',
  'Cầu cho cửa hàng nhỏ của con đắt khách',
  'Nguyện mọi chúng sinh đều được an vui',
  'Cầu cho con trai đi làm xa luôn khỏe mạnh, bình an',
  'Xin cho con sớm trả hết nợ nần',
  'Con cầu mong sự nghiệp học hành của con suôn sẻ',
  'Cầu cho cả nhà vạn sự như ý',
  'Mong cho bố con bỏ được rượu, gia đình yên ấm',
  'Cầu cho bà ngoại sống lâu trăm tuổi',
  'Xin cho chuyến đi công tác sắp tới mọi việc thuận lợi',
  'Nam Mô Quan Thế Âm Bồ Tát, xin cứu khổ cứu nạn',
  'Con xin cầu duyên lành, sớm gặp người thương',
  'Cầu cho con cái trong nhà biết nghe lời cha mẹ',
  'Mong sức khỏe của cả nhà ngày càng tốt hơn',
  'Xin cho con đủ sức lo cho gia đình',
  'Cầu cho dự án con đang làm được thuận lợi hoàn thành',
  'Con xin được bình an, tâm thanh tịnh',
  'Cầu cho thời tiết thuận hòa, mùa màng bội thu',
  'Xin cho em bé trong bụng con khỏe mạnh, mẹ tròn con vuông',
  'Cầu cho bạn bè đồng nghiệp đều gặp nhiều may mắn',
  'Mong sớm có tiền mua được căn nhà nhỏ cho cả nhà',
  'Con xin gieo quẻ xem dạo này công việc ra sao',
  'Cầu cho ba mẹ bớt vất vả, con sẽ cố gắng hơn',
  'Nguyện cầu cho những người xa quê được sớm về sum họp',
  'Xin Phật soi đường chỉ lối cho con chọn đúng hướng đi',
  'Cầu cho con thi cử đỗ đạt, thầy cô bạn bè đều thương',
  'Xin cho nhà con có thêm tin vui, mọi điều hanh thông',
  'Con cầu cho hàng xóm láng giềng hòa thuận, xóm làng bình yên',
  'Nguyện cầu cho những người đang vất vả mưu sinh có thêm sức khỏe',
  'Cầu cho em trai con sớm tìm được việc ổn định',
  'Xin cho con bớt nóng giận, biết yêu thương gia đình nhiều hơn',
  'Cầu cho chị gái con sinh nở mẹ tròn con vuông',
  'Mong cho quán ăn nhỏ của vợ chồng con có khách quen',
  'Cầu cho chú con phẫu thuật thành công, sớm khỏe lại',
  'Con xin cầu bình an cho người đang đi biển xa nhà',
  'Xin Phật gia hộ cho xe cộ đi lại được an toàn',
  'Cầu cho con đừng quá áp lực, giữ được tâm bình an',
  'Mong người con thương cũng thương con, duyên lành sớm đến',
  'Xin cho vườn rau nhà con tươi tốt, cả nhà đủ ăn đủ mặc',
  'Con cầu cho cô giáo cũ của con sức khỏe, hạnh phúc',
  'Cầu cho bạn thân của con vượt qua chuyện buồn',
  'Nam Mô A Di Đà Phật, con xin hồi hướng công đức cho mọi người',
  'Xin cho con có đủ kiên nhẫn để nuôi dạy các con',
  'Cầu cho hợp đồng sắp ký của con được suôn sẻ',
  'Con xin được học thêm nghề mới và làm được',
  'Cầu cho mẹ chồng con khỏe mạnh, cả nhà hòa thuận',
  'Mong con chó nhà con khỏi bệnh, nhà con thương nó lắm',
  'Cầu cho thầy thuốc chữa bệnh cho bố con tận tâm, bố con mau khỏe',
  'Xin cho con vượt qua nỗi sợ để bước tiếp trên con đường mình chọn',
  'Cầu cho cháu nội nhà con ngoan, lớn lên khỏe mạnh',
  'Con cầu cho công việc bán hàng online dạo này có nhiều đơn',
  'Xin cho tụi con đi làm xa, tết nào cũng về được với ba mẹ',
  'Mong cho những ai đang cô đơn đêm nay được bình yên',
  'Cầu cho nhà con tránh được bão lũ, người người bình an',
  'Xin Phật gia hộ cho con bớt mất ngủ, tâm trí nhẹ nhàng',
  'Cầu cho cô chú bán vé số đầu ngõ ngày nào cũng bán hết',
  'Con xin cầu cho ông nội đừng đau chân nữa',
  'Cầu cho đội của con làm việc ăn ý, dự án chạy tốt',
  'Mong con đủ dũng khí xin lỗi người con đã làm buồn',
  'Xin cho sức khỏe con ổn định, đi khám kết quả tốt',
  'Cầu cho gia đình con ăn nên làm ra, con cái hiếu thảo',
  'Con xin cầu cho những em nhỏ khó khăn có cơm ăn áo mặc',
  'Cầu mong con giữ được sự bình tĩnh trước những chuyện khó',
  'Xin cho con tìm lại được niềm vui trong công việc',
  'Cầu cho hôm nay mọi việc của con đều thuận lợi',
  'Con thành tâm cầu cho người đã khuất được siêu thoát, an nghỉ',
  'Cầu cho chồng con bớt làm đêm, giữ gìn sức khỏe',
  'Mong cho con sớm hoàn thành xong khóa học đang theo',
  'Xin cho cả nhà đi khám sức khỏe đều bình thường',
  'Cầu cho bé nhà con ngủ ngon, không quấy khóc đêm',
  'Con xin cầu cho mối quan hệ với ba mẹ chồng được hòa thuận',
  'Nguyện cầu cho tất cả những ai đang xem đều bình an, vui khỏe',
  'Cầu cho anh trai con sớm vượt qua giai đoạn khó khăn về tài chính',
  'Xin cho con sống tử tế, biết cho đi mà không mong nhận lại',
  'Cầu cho khách hàng của con tin tưởng, công việc suôn sẻ',
  'Con xin hồi hướng công đức cho cha mẹ nhiều đời',
  'Mong ngày mai nắng đẹp, đi làm thuận lợi, về nhà bình an',
  'Cầu cho thầy cô trong trường con luôn mạnh khỏe, tâm nhẹ nhàng',
  'Xin Phật cho con biết đủ, biết ơn những gì mình đang có',
  'Con cầu cho chuyến hàng của chồng con đi đường bình an, giao đúng hẹn',
  'Cầu cho em con mới đi làm gặp được sếp tốt, đồng nghiệp tử tế',
  'Xin cho nhà con có chỗ ở ổn định, không phải chuyển đi chuyển lại',
  'Cầu cho người thân con ở nước ngoài luôn mạnh khỏe, đủ đầy',
  'Mong con có thêm niềm tin và sức mạnh để làm lại từ đầu',
  'Con xin cầu cho cô hàng xóm sống một mình luôn khỏe mạnh'
]);

module.exports = { NPC_POOL, NPC_ALL, NPC_WISHES, createWishDeck };
