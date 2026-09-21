/** 본체 DocMoa와 같은 20개 로케일. 영어는 프리픽스 없이 /cad, 나머지는 docmoa.com/<로케일>/cad. */
export const LOCALES = ["en", "ko", "ja", "zh", "zh-tw", "es", "pt", "fr", "de", "it", "ru", "id", "vi", "th", "tr", "ar", "hi", "pl", "nl", "ms"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const isLocale = (x: string): x is Locale => (LOCALES as readonly string[]).includes(x);
export const isRtl = (l: Locale) => l === "ar";
/** 이 앱의 canonical은 본체 랜딩(docmoa.com/cad)이다. 앱 자체는 색인에서 뺀다. */
export const pageUrl = (l: Locale) => (l === DEFAULT_LOCALE ? "https://docmoa.com/cad" : `https://docmoa.com/${l}/cad`);

/** {n}, {list}는 화면에서 채운다. 함수로 두면 서버에서 클라이언트로 못 넘긴다. */
export type Dict = {
  title: string; desc: string;
  open: string; opening: string; layers: string; view3d: string; view2d: string; fit: string;
  png: string; pdf: string; saving: string; making: string;
  err: { open: string; read: string; draw: string; save: string; png: string; font: string };
  wire: string; empty: string; skipped: string;
};

const en: Dict = {
  title: "DWG viewer · open CAD drawings | DocMoa",
  desc: "Open DWG and DXF drawings in your browser — no AutoCAD. No login, no size limit, and the file never leaves your device.",
  open: "Open drawing", opening: "Opening…", layers: "Layers", view3d: "3D view", view2d: "2D drawing", fit: "Fit to screen",
  png: "Save PNG", pdf: "Save PDF", saving: "Saving…", making: "Building…",
  err: {
    open: "Could not open the file.",
    read: "Could not read the drawing. The file is damaged or in an unsupported format.",
    draw: "Could not draw this file.",
    save: "Could not save.",
    png: "Could not turn the drawing into an image.",
    font: "Could not load the font.",
  },
  wire: "{n} solid(s) show edges only; faces are not drawn.",
  empty: "{n} solid(s) had no edges and are not shown.",
  skipped: "Unsupported curves: {list}.",
};

const ko: Dict = {
  title: "DWG 뷰어 · 도면 보기 | DocMoa",
  desc: "AutoCAD 없이 브라우저에서 DWG·DXF 도면을 엽니다. 로그인·용량 제한 없음, 파일은 서버로 전송되지 않습니다.",
  open: "도면 열기", opening: "여는 중…", layers: "레이어", view3d: "3D 보기", view2d: "2D 도면", fit: "전체 보기",
  png: "PNG 저장", pdf: "PDF 저장", saving: "저장 중…", making: "만드는 중…",
  err: {
    open: "파일을 열지 못했습니다.",
    read: "도면을 읽지 못했습니다. 파일이 손상됐거나 지원하지 않는 형식입니다.",
    draw: "도면을 그릴 수 없습니다.",
    save: "저장하지 못했습니다.",
    png: "그림으로 바꾸지 못했습니다.",
    font: "폰트를 받지 못했습니다.",
  },
  wire: "입체 {n}개는 모서리만 표시됩니다(면은 그리지 않음).",
  empty: "입체 {n}개는 모서리가 없어 표시되지 않았습니다.",
  skipped: "지원하지 않는 곡선: {list}.",
};

const ja: Dict = {
  title: "DWGビューア · 図面を開く | DocMoa",
  desc: "AutoCADなしでブラウザーからDWG・DXF図面を開きます。ログイン不要、容量制限なし、ファイルは端末の外に出ません。",
  open: "図面を開く", opening: "読み込み中…", layers: "レイヤー", view3d: "3D表示", view2d: "2D図面", fit: "全体表示",
  png: "PNGで保存", pdf: "PDFで保存", saving: "保存中…", making: "作成中…",
  err: {
    open: "ファイルを開けませんでした。",
    read: "図面を読み取れませんでした。ファイルが壊れているか、対応していない形式です。",
    draw: "この図面は描画できませんでした。",
    save: "保存できませんでした。",
    png: "画像に変換できませんでした。",
    font: "フォントを取得できませんでした。",
  },
  wire: "立体{n}個は稜線のみ表示されます(面は描画しません)。",
  empty: "立体{n}個は稜線がないため表示されていません。",
  skipped: "未対応の曲線: {list}。",
};

const zh: Dict = {
  title: "DWG 查看器 · 打开图纸 | DocMoa",
  desc: "无需 AutoCAD，在浏览器中打开 DWG、DXF 图纸。无需登录、没有大小限制，文件不会离开你的设备。",
  open: "打开图纸", opening: "正在打开…", layers: "图层", view3d: "三维视图", view2d: "二维图纸", fit: "适应窗口",
  png: "保存 PNG", pdf: "保存 PDF", saving: "正在保存…", making: "正在生成…",
  err: {
    open: "无法打开文件。",
    read: "无法读取图纸。文件已损坏或格式不受支持。",
    draw: "无法绘制该图纸。",
    save: "保存失败。",
    png: "无法转换为图片。",
    font: "无法加载字体。",
  },
  wire: "{n} 个实体仅显示棱边（不绘制面）。",
  empty: "{n} 个实体没有棱边，未显示。",
  skipped: "不支持的曲线：{list}。",
};

const zhTW: Dict = {
  title: "DWG 檢視器 · 開啟圖面 | DocMoa",
  desc: "不需要 AutoCAD，直接在瀏覽器開啟 DWG、DXF 圖面。免登入、無容量限制，檔案不會離開你的裝置。",
  open: "開啟圖面", opening: "開啟中…", layers: "圖層", view3d: "3D 檢視", view2d: "2D 圖面", fit: "顯示全部",
  png: "儲存 PNG", pdf: "儲存 PDF", saving: "儲存中…", making: "產生中…",
  err: {
    open: "無法開啟檔案。",
    read: "無法讀取圖面。檔案已損毀或格式不支援。",
    draw: "無法繪製這個圖面。",
    save: "儲存失敗。",
    png: "無法轉換成圖片。",
    font: "無法載入字型。",
  },
  wire: "{n} 個實體只顯示稜邊（不繪製面）。",
  empty: "{n} 個實體沒有稜邊，因此沒有顯示。",
  skipped: "不支援的曲線：{list}。",
};

const es: Dict = {
  title: "Visor DWG · abrir planos | DocMoa",
  desc: "Abre planos DWG y DXF en el navegador, sin AutoCAD. Sin registro ni límite de tamaño, y el archivo nunca sale de tu dispositivo.",
  open: "Abrir plano", opening: "Abriendo…", layers: "Capas", view3d: "Vista 3D", view2d: "Plano 2D", fit: "Ajustar a pantalla",
  png: "Guardar PNG", pdf: "Guardar PDF", saving: "Guardando…", making: "Generando…",
  err: {
    open: "No se pudo abrir el archivo.",
    read: "No se pudo leer el plano. El archivo está dañado o el formato no es compatible.",
    draw: "No se pudo dibujar este plano.",
    save: "No se pudo guardar.",
    png: "No se pudo convertir en imagen.",
    font: "No se pudo cargar la fuente.",
  },
  wire: "{n} sólido(s) muestran solo las aristas; las caras no se dibujan.",
  empty: "{n} sólido(s) no tenían aristas y no se muestran.",
  skipped: "Curvas no compatibles: {list}.",
};

const pt: Dict = {
  title: "Visualizador DWG · abrir plantas | DocMoa",
  desc: "Abra desenhos DWG e DXF no navegador, sem AutoCAD. Sem login nem limite de tamanho, e o arquivo não sai do seu dispositivo.",
  open: "Abrir desenho", opening: "Abrindo…", layers: "Camadas", view3d: "Vista 3D", view2d: "Desenho 2D", fit: "Ajustar à tela",
  png: "Salvar PNG", pdf: "Salvar PDF", saving: "Salvando…", making: "Gerando…",
  err: {
    open: "Não foi possível abrir o arquivo.",
    read: "Não foi possível ler o desenho. O arquivo está danificado ou o formato não é compatível.",
    draw: "Não foi possível desenhar este arquivo.",
    save: "Não foi possível salvar.",
    png: "Não foi possível converter em imagem.",
    font: "Não foi possível carregar a fonte.",
  },
  wire: "{n} sólido(s) mostram apenas as arestas; as faces não são desenhadas.",
  empty: "{n} sólido(s) não tinham arestas e não são exibidos.",
  skipped: "Curvas não suportadas: {list}.",
};

const fr: Dict = {
  title: "Visionneuse DWG · ouvrir un plan | DocMoa",
  desc: "Ouvrez vos plans DWG et DXF dans le navigateur, sans AutoCAD. Sans compte ni limite de taille, et le fichier ne quitte pas votre appareil.",
  open: "Ouvrir un plan", opening: "Ouverture…", layers: "Calques", view3d: "Vue 3D", view2d: "Plan 2D", fit: "Ajuster à l'écran",
  png: "Enregistrer en PNG", pdf: "Enregistrer en PDF", saving: "Enregistrement…", making: "Génération…",
  err: {
    open: "Impossible d'ouvrir le fichier.",
    read: "Impossible de lire le plan. Le fichier est endommagé ou le format n'est pas pris en charge.",
    draw: "Impossible de dessiner ce plan.",
    save: "Enregistrement impossible.",
    png: "Impossible de convertir en image.",
    font: "Impossible de charger la police.",
  },
  wire: "{n} solide(s) n'affichent que les arêtes ; les faces ne sont pas dessinées.",
  empty: "{n} solide(s) sans arête ne sont pas affichés.",
  skipped: "Courbes non prises en charge : {list}.",
};

const de: Dict = {
  title: "DWG-Betrachter · Zeichnung öffnen | DocMoa",
  desc: "DWG- und DXF-Zeichnungen im Browser öffnen, ganz ohne AutoCAD. Ohne Anmeldung, ohne Größenlimit, und die Datei verlässt Ihr Gerät nicht.",
  open: "Zeichnung öffnen", opening: "Wird geöffnet…", layers: "Layer", view3d: "3D-Ansicht", view2d: "2D-Zeichnung", fit: "Alles anzeigen",
  png: "Als PNG speichern", pdf: "Als PDF speichern", saving: "Wird gespeichert…", making: "Wird erstellt…",
  err: {
    open: "Die Datei konnte nicht geöffnet werden.",
    read: "Die Zeichnung konnte nicht gelesen werden. Die Datei ist beschädigt oder das Format wird nicht unterstützt.",
    draw: "Diese Zeichnung konnte nicht dargestellt werden.",
    save: "Speichern nicht möglich.",
    png: "Umwandlung in ein Bild nicht möglich.",
    font: "Die Schrift konnte nicht geladen werden.",
  },
  wire: "{n} Körper zeigen nur Kanten; Flächen werden nicht gezeichnet.",
  empty: "{n} Körper haben keine Kanten und werden nicht angezeigt.",
  skipped: "Nicht unterstützte Kurven: {list}.",
};

const it: Dict = {
  title: "Visualizzatore DWG · aprire disegni | DocMoa",
  desc: "Apri disegni DWG e DXF nel browser, senza AutoCAD. Senza registrazione né limiti di dimensione, e il file non lascia il tuo dispositivo.",
  open: "Apri disegno", opening: "Apertura…", layers: "Livelli", view3d: "Vista 3D", view2d: "Disegno 2D", fit: "Adatta allo schermo",
  png: "Salva PNG", pdf: "Salva PDF", saving: "Salvataggio…", making: "Creazione…",
  err: {
    open: "Impossibile aprire il file.",
    read: "Impossibile leggere il disegno. Il file è danneggiato o il formato non è supportato.",
    draw: "Impossibile disegnare questo file.",
    save: "Salvataggio non riuscito.",
    png: "Impossibile convertire in immagine.",
    font: "Impossibile caricare il carattere.",
  },
  wire: "{n} solidi mostrano solo gli spigoli; le facce non vengono disegnate.",
  empty: "{n} solidi non avevano spigoli e non sono mostrati.",
  skipped: "Curve non supportate: {list}.",
};

const ru: Dict = {
  title: "Просмотр DWG · открыть чертёж | DocMoa",
  desc: "Открывайте чертежи DWG и DXF в браузере без AutoCAD. Без регистрации и ограничений по размеру, файл не покидает ваше устройство.",
  open: "Открыть чертёж", opening: "Открываем…", layers: "Слои", view3d: "3D-вид", view2d: "2D-чертёж", fit: "Вписать в экран",
  png: "Сохранить PNG", pdf: "Сохранить PDF", saving: "Сохраняем…", making: "Создаём…",
  err: {
    open: "Не удалось открыть файл.",
    read: "Не удалось прочитать чертёж. Файл повреждён или формат не поддерживается.",
    draw: "Не удалось отрисовать этот чертёж.",
    save: "Не удалось сохранить.",
    png: "Не удалось преобразовать в изображение.",
    font: "Не удалось загрузить шрифт.",
  },
  wire: "У {n} тел показаны только рёбра — грани не строятся.",
  empty: "{n} тел без рёбер не показаны.",
  skipped: "Неподдерживаемые кривые: {list}.",
};

const id: Dict = {
  title: "Penampil DWG · buka gambar teknik | DocMoa",
  desc: "Buka gambar DWG dan DXF langsung di browser, tanpa AutoCAD. Tanpa login, tanpa batas ukuran, dan berkas tidak meninggalkan perangkat Anda.",
  open: "Buka gambar", opening: "Membuka…", layers: "Layer", view3d: "Tampilan 3D", view2d: "Gambar 2D", fit: "Paskan ke layar",
  png: "Simpan PNG", pdf: "Simpan PDF", saving: "Menyimpan…", making: "Membuat…",
  err: {
    open: "Tidak dapat membuka berkas.",
    read: "Tidak dapat membaca gambar. Berkas rusak atau formatnya tidak didukung.",
    draw: "Gambar ini tidak dapat ditampilkan.",
    save: "Gagal menyimpan.",
    png: "Tidak dapat mengubah menjadi gambar.",
    font: "Tidak dapat memuat font.",
  },
  wire: "{n} objek padat hanya menampilkan rusuk; permukaannya tidak digambar.",
  empty: "{n} objek padat tidak punya rusuk sehingga tidak ditampilkan.",
  skipped: "Kurva yang tidak didukung: {list}.",
};

const vi: Dict = {
  title: "Trình xem DWG · mở bản vẽ | DocMoa",
  desc: "Mở bản vẽ DWG và DXF ngay trên trình duyệt, không cần AutoCAD. Không đăng nhập, không giới hạn dung lượng, tệp không rời khỏi thiết bị của bạn.",
  open: "Mở bản vẽ", opening: "Đang mở…", layers: "Lớp", view3d: "Xem 3D", view2d: "Bản vẽ 2D", fit: "Vừa màn hình",
  png: "Lưu PNG", pdf: "Lưu PDF", saving: "Đang lưu…", making: "Đang tạo…",
  err: {
    open: "Không mở được tệp.",
    read: "Không đọc được bản vẽ. Tệp bị hỏng hoặc định dạng không được hỗ trợ.",
    draw: "Không vẽ được bản vẽ này.",
    save: "Không lưu được.",
    png: "Không chuyển được thành ảnh.",
    font: "Không tải được phông chữ.",
  },
  wire: "{n} khối chỉ hiện cạnh; không vẽ mặt.",
  empty: "{n} khối không có cạnh nên không được hiển thị.",
  skipped: "Đường cong không hỗ trợ: {list}.",
};

const th: Dict = {
  title: "โปรแกรมดู DWG · เปิดแบบแปลน | DocMoa",
  desc: "เปิดไฟล์แบบ DWG และ DXF ในเบราว์เซอร์ได้เลย ไม่ต้องมี AutoCAD ไม่ต้องล็อกอิน ไม่จำกัดขนาด และไฟล์ไม่ถูกส่งออกจากเครื่องของคุณ",
  open: "เปิดแบบแปลน", opening: "กำลังเปิด…", layers: "เลเยอร์", view3d: "มุมมอง 3 มิติ", view2d: "แบบ 2 มิติ", fit: "พอดีหน้าจอ",
  png: "บันทึก PNG", pdf: "บันทึก PDF", saving: "กำลังบันทึก…", making: "กำลังสร้าง…",
  err: {
    open: "เปิดไฟล์ไม่สำเร็จ",
    read: "อ่านแบบแปลนไม่ได้ ไฟล์เสียหายหรือเป็นรูปแบบที่ไม่รองรับ",
    draw: "วาดแบบแปลนนี้ไม่ได้",
    save: "บันทึกไม่สำเร็จ",
    png: "แปลงเป็นรูปภาพไม่สำเร็จ",
    font: "โหลดฟอนต์ไม่สำเร็จ",
  },
  wire: "รูปทรงตัน {n} ชิ้นแสดงเฉพาะขอบ ไม่ได้วาดผิวหน้า",
  empty: "รูปทรงตัน {n} ชิ้นไม่มีขอบ จึงไม่ถูกแสดง",
  skipped: "เส้นโค้งที่ไม่รองรับ: {list}",
};

const tr: Dict = {
  title: "DWG görüntüleyici · çizim açma | DocMoa",
  desc: "DWG ve DXF çizimlerini AutoCAD olmadan tarayıcıda açın. Üyelik yok, boyut sınırı yok ve dosya cihazınızdan çıkmaz.",
  open: "Çizim aç", opening: "Açılıyor…", layers: "Katmanlar", view3d: "3B görünüm", view2d: "2B çizim", fit: "Ekrana sığdır",
  png: "PNG kaydet", pdf: "PDF kaydet", saving: "Kaydediliyor…", making: "Oluşturuluyor…",
  err: {
    open: "Dosya açılamadı.",
    read: "Çizim okunamadı. Dosya bozuk ya da biçimi desteklenmiyor.",
    draw: "Bu çizim çizilemedi.",
    save: "Kaydedilemedi.",
    png: "Görsele dönüştürülemedi.",
    font: "Yazı tipi yüklenemedi.",
  },
  wire: "{n} katı yalnızca kenarlarıyla gösteriliyor; yüzeyler çizilmiyor.",
  empty: "{n} katının kenarı yok, bu yüzden gösterilmiyor.",
  skipped: "Desteklenmeyen eğriler: {list}.",
};

const ar: Dict = {
  title: "عارض DWG · فتح المخططات | DocMoa",
  desc: "افتح مخططات DWG وDXF في المتصفح دون AutoCAD. بلا تسجيل دخول ولا حد للحجم، والملف لا يغادر جهازك.",
  open: "فتح مخطط", opening: "جارٍ الفتح…", layers: "الطبقات", view3d: "عرض ثلاثي الأبعاد", view2d: "مخطط ثنائي الأبعاد", fit: "ملء الشاشة",
  png: "حفظ PNG", pdf: "حفظ PDF", saving: "جارٍ الحفظ…", making: "جارٍ الإنشاء…",
  err: {
    open: "تعذّر فتح الملف.",
    read: "تعذّرت قراءة المخطط. الملف تالف أو تنسيقه غير مدعوم.",
    draw: "تعذّر رسم هذا المخطط.",
    save: "تعذّر الحفظ.",
    png: "تعذّر التحويل إلى صورة.",
    font: "تعذّر تحميل الخط.",
  },
  wire: "{n} من المجسمات تظهر حوافها فقط، ولا تُرسم أوجهها.",
  empty: "{n} من المجسمات بلا حواف فلم تظهر.",
  skipped: "منحنيات غير مدعومة: {list}.",
};

const hi: Dict = {
  title: "DWG व्यूअर · ड्रॉइंग खोलें | DocMoa",
  desc: "AutoCAD के बिना ब्राउज़र में ही DWG और DXF ड्रॉइंग खोलें। न लॉगिन, न आकार की सीमा, और फ़ाइल आपके डिवाइस से बाहर नहीं जाती।",
  open: "ड्रॉइंग खोलें", opening: "खोला जा रहा है…", layers: "लेयर", view3d: "3D दृश्य", view2d: "2D ड्रॉइंग", fit: "स्क्रीन में फ़िट करें",
  png: "PNG सहेजें", pdf: "PDF सहेजें", saving: "सहेजा जा रहा है…", making: "बनाया जा रहा है…",
  err: {
    open: "फ़ाइल नहीं खुल सकी।",
    read: "ड्रॉइंग पढ़ी नहीं जा सकी। फ़ाइल ख़राब है या प्रारूप समर्थित नहीं है।",
    draw: "यह ड्रॉइंग बनाई नहीं जा सकी।",
    save: "सहेजा नहीं जा सका।",
    png: "छवि में नहीं बदला जा सका।",
    font: "फ़ॉन्ट लोड नहीं हो सका।",
  },
  wire: "{n} ठोस आकृतियों में केवल किनारे दिखते हैं; सतहें नहीं बनाई जातीं।",
  empty: "{n} ठोस आकृतियों में किनारे नहीं थे, इसलिए वे नहीं दिखाई गईं।",
  skipped: "असमर्थित वक्र: {list}।",
};

const pl: Dict = {
  title: "Przeglądarka DWG · otwieranie rysunków | DocMoa",
  desc: "Otwieraj rysunki DWG i DXF w przeglądarce, bez AutoCAD-a. Bez logowania i limitu rozmiaru, a plik nie opuszcza Twojego urządzenia.",
  open: "Otwórz rysunek", opening: "Otwieranie…", layers: "Warstwy", view3d: "Widok 3D", view2d: "Rysunek 2D", fit: "Dopasuj do ekranu",
  png: "Zapisz PNG", pdf: "Zapisz PDF", saving: "Zapisywanie…", making: "Tworzenie…",
  err: {
    open: "Nie udało się otworzyć pliku.",
    read: "Nie udało się odczytać rysunku. Plik jest uszkodzony lub format nie jest obsługiwany.",
    draw: "Nie udało się narysować tego pliku.",
    save: "Nie udało się zapisać.",
    png: "Nie udało się zamienić na obraz.",
    font: "Nie udało się wczytać czcionki.",
  },
  wire: "{n} bryły pokazują tylko krawędzie; ściany nie są rysowane.",
  empty: "{n} bryły nie mają krawędzi i nie są pokazane.",
  skipped: "Nieobsługiwane krzywe: {list}.",
};

const nl: Dict = {
  title: "DWG-viewer · tekeningen openen | DocMoa",
  desc: "Open DWG- en DXF-tekeningen in de browser, zonder AutoCAD. Geen account, geen groottelimiet, en het bestand blijft op uw apparaat.",
  open: "Tekening openen", opening: "Bezig met openen…", layers: "Lagen", view3d: "3D-weergave", view2d: "2D-tekening", fit: "Passend maken",
  png: "PNG opslaan", pdf: "PDF opslaan", saving: "Bezig met opslaan…", making: "Bezig met maken…",
  err: {
    open: "Kan het bestand niet openen.",
    read: "Kan de tekening niet lezen. Het bestand is beschadigd of de indeling wordt niet ondersteund.",
    draw: "Kan deze tekening niet tekenen.",
    save: "Opslaan is mislukt.",
    png: "Omzetten naar een afbeelding is mislukt.",
    font: "Kan het lettertype niet laden.",
  },
  wire: "{n} vaste vorm(en) tonen alleen de randen; vlakken worden niet getekend.",
  empty: "{n} vaste vorm(en) hadden geen randen en worden niet getoond.",
  skipped: "Niet-ondersteunde krommen: {list}.",
};

const ms: Dict = {
  title: "Pemapar DWG · buka lukisan | DocMoa",
  desc: "Buka lukisan DWG dan DXF terus dalam pelayar, tanpa AutoCAD. Tiada log masuk, tiada had saiz, dan fail tidak meninggalkan peranti anda.",
  open: "Buka lukisan", opening: "Sedang dibuka…", layers: "Lapisan", view3d: "Paparan 3D", view2d: "Lukisan 2D", fit: "Muat skrin",
  png: "Simpan PNG", pdf: "Simpan PDF", saving: "Menyimpan…", making: "Menjana…",
  err: {
    open: "Fail tidak dapat dibuka.",
    read: "Lukisan tidak dapat dibaca. Fail rosak atau formatnya tidak disokong.",
    draw: "Lukisan ini tidak dapat dipaparkan.",
    save: "Gagal menyimpan.",
    png: "Gagal menukar kepada imej.",
    font: "Gagal memuatkan fon.",
  },
  wire: "{n} objek padu hanya menunjukkan tepi; permukaan tidak dilukis.",
  empty: "{n} objek padu tiada tepi, jadi tidak dipaparkan.",
  skipped: "Lengkung yang tidak disokong: {list}.",
};

const DICTS: Record<Locale, Dict> = { en, ko, ja, zh, "zh-tw": zhTW, es, pt, fr, de, it, ru, id, vi, th, tr, ar, hi, pl, nl, ms };
export const getDict = (l: Locale): Dict => DICTS[l];
/** "입체 {n}개…" 같은 자리를 채운다. */
export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
