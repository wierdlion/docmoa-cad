# DocMoa CAD

브라우저에서 DWG·DXF 도면을 열고 PDF/PNG로 내보낸다. 파일은 서버로 전송되지 않는다.

## 왜 별도 프로젝트인가

도면 파싱에 쓰는 [LibreDWG](https://www.gnu.org/software/libredwg/)(GPL-3)를 WASM으로 브라우저에
내려보내는 것은 GPL이 말하는 배포에 해당한다. 그래서 이 앱은 GPL-3로 공개하고, 본체 DocMoa
(`../site`)와는 **빌드를 분리한다.** 같은 저장소에 라우트로 넣으면 같은 번들이 되어 본체까지
GPL이 되므로, 합치지 말 것.

배포는 별도 Vercel 프로젝트로 올리고 `docmoa.com/cad` → 이 프로젝트로 rewrite 한다.
`basePath`가 `/cad`인 이유다.

## 개발

```bash
npm install     # postinstall이 wasm을 public/wasm/으로 복사한다
npm run dev     # http://localhost:3457/cad
npm test        # 도면 파싱 스모크 테스트
```

## 한글

- 도면 텍스트 인코딩(CP949)은 libredwg가 `$DWGCODEPAGE`를 보고 처리한다.
- 변환기가 텍스트를 XML 이스케이프하지 않아, 치수에 흔한 `<53>` 표기 하나로 도면 전체가 안
  열렸다. `lib/dwg.ts`의 `repairXml`이 막는다.
- PDF는 jsPDF 기본 폰트가 Latin-1뿐이라 한글이 깨진다. 나눔고딕(OFL, 2MB)을 심으며, PDF 버튼을
  누를 때만 받는다.

## 알려진 한계

- **SHX·빅폰트 한글**: 글리프가 도면 파일 안에 없고 작성자 PC의 `.shx`에 있다. 어떤 뷰어도
  원본대로 못 그리며 대체 폰트로 근사한다. 인코딩(CP949) 깨짐은 라이브러리가 처리한다.
- **복잡한 블록의 PDF 출력**: svg2pdf가 `<use>`로 참조된 일부 블록을 누락시키는 경우가 있다.
  단순 도형·텍스트는 정상.
- **여러 덩어리로 흩어진 도면**: `lib/fit.ts`가 바깥 5%를 잘라 화면을 맞추므로 일부가 잘릴 수
  있다. "전체 보기"로 다시 맞춘다.
- **쓰기 없음**: 이 빌드의 LibreDWG는 읽기 전용이다. 버전 변환(2018→2013)은 불가.
- **3D 없음**: `3DSOLID`는 형상 데이터(ACIS)가 넘어오지 않는다(`satCache`만 있고 비어 있음).
  `3DFACE`/`POLYLINE3D`는 좌표가 있으므로 나중에 3D로 그릴 수는 있다.
