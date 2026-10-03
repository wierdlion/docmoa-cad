# DocMoa CAD

브라우저에서 DWG·DXF 도면을 열고 PDF/PNG로 내보낸다. 파일은 서버로 전송되지 않는다.

## 왜 별도 프로젝트인가

도면 파싱에 쓰는 [LibreDWG](https://www.gnu.org/software/libredwg/)(GPL-3)를 WASM으로 브라우저에
내려보내는 것은 GPL이 말하는 배포에 해당한다. 그래서 이 앱은 GPL-3로 공개하고, 본체 DocMoa
(`../site`)와는 **빌드를 분리한다.** 같은 저장소에 라우트로 넣으면 같은 번들이 되어 본체까지
GPL이 되므로, 합치지 말 것.

배포는 별도 Vercel 프로젝트로 올리고 `docmoa.com/cad/*` → 이 프로젝트로 rewrite 한다.
`basePath`가 `/cad`인 이유다.

## 개발

```bash
npm install     # postinstall이 wasm을 public/wasm/으로 복사한다
npm run dev     # http://localhost:3457/cad/view
npm test        # 도면 파싱·장면·DXF 단위 테스트
npm run lint    # eslint (eslint-config-next). 렌더 중 ref 접근 같은 React 규칙까지 본다
```

## DXF

libredwg-web 0.7.14의 WASM은 DXF를 못 읽는다(`dwg_read_data`의 DXF 분기가 주석 처리돼 있어 어떤 DXF든 null).
그래서 DXF는 같은 저자의 JS 파서 [@mlightcad/dxf-json](https://www.npmjs.com/package/@mlightcad/dxf-json)(GPL-3)으로
읽고, `lib/dxf.ts`가 그 결과를 libredwg-web `convert`와 같은 모양으로 바꿔 `lib/build.ts`에 넘긴다. 파서는 DXF를 열 때만
받는다(워커의 동적 import). 맞춰 주는 것: 각도(도→라디안), 선굵기(1/100mm→libredwg 번호), 블록 엔티티(`blocks`→BLOCK_RECORD),
INSERT 뒤에 따로 오는 ATTRIB, R12의 `$Model_Space` 이름과 LAYOUT 없음. R2007 이전 파일은 `$DWGCODEPAGE`(CP949 등)로
풀고, R12는 블록 끝 표식(`100 AcDbBlockEnd`)이 없어 dxf-json이 블록 하나로 파일 끝까지 삼키므로 표식을 끼워 넣는다(`patchR12`).
입체(3DSOLID)의 ACIS 글자는 dxf-json이 되돌려 주어 R2010까지는 모서리가 나온다. 샘플은 ezdxf로 만든 `tests/fixtures/ezdxf_*.dxf`다(배치·뷰포트가 든
유일한 샘플이기도 하다). CP949 샘플은 바이트가 UTF-8이 아니라 `tests/dxf.test.mts` 안에서 만든다.

## 그리는 방법

libredwg-web이 DWG를 JS 객체로 풀어 주면(`lib.convert`), `lib/build.ts`가 그 엔티티를 직접 읽어
캔버스가 그릴 좌표 배열("장면", `lib/scene.ts`)로 만든다. 라이브러리의 SVG 변환기는 쓰지 않는다 —
글자 회전·폭·정렬, 블록 속성(ATTRIB), 해치·SOLID·지시선·다중선, 선종류·선굵기, 꺼진 레이어를
전부 빠뜨리고, 클래스가 export되지 않아 밖에서 고칠 수도 없었다(2026-10-03 교체).

- 파싱과 장면 만들기는 워커(`lib/dwg.worker.ts`)에서 끝나고 메인 스레드에는 TypedArray만 넘어온다.
- `lib/canvas.ts`가 스타일(색·점선·굵기)별로 묶어 그린다. 끄는 동안은 마지막 그림을 옮겨 보여주고
  멈추면 다시 그린다. PDF는 같은 `drawSheet`를 jsPDF 명령으로 바꿔 주는 가짜 컨텍스트(`lib/export.ts`)로
  돌리므로 화면에 보이는 그대로 나온다. PNG는 같은 코드를 오프스크린 캔버스에 그린 것이다. 저장 범위는 뷰 상자가
  아니라 **화면에 실제로 보이는 범위**(캔버스 비율로 넓힌 것)이고, PDF 용지 방향도 그 비율을 따른다.
- 글자: 도면의 글자 높이는 대문자 높이라 글꼴 em은 그 1/0.72배로 잡는다. 정렬된 글자는 파일에 든
  시작점과 정렬점에서 실제 폭을 알아내어, 글꼴이 달라도 그 폭에 맞춘다(`TextItem.w`).
- 레이어: 꺼짐·동결 레이어는 꺼진 채 열린다. 블록 안 엔티티는 자기 레이어를 따르고, 레이어 0인 것만
  삽입의 레이어를 물려받는다(AutoCAD와 같음). 동결 레이어에 삽입된 블록은 통째로 그 레이어와 숨는다.
- 배치(종이 공간) 탭: 뷰포트 안에 모델 장면을 축척대로 잘라 넣는다. 뷰 비틀림(twist)과 뷰포트별 동결
  레이어는 반영하지 않는다. 배치가 든 DWG 샘플은 없고 DXF 샘플(`tests/fixtures/ezdxf_2018.dxf`의 Sheet1)로 검증한다.
  모델 공간이 비어 있고 배치만 있으면 그 배치부터 연다.
- MTEXT 줄바꿈: 워커가 OffscreenCanvas로 화면과 같은 글꼴의 폭을 재서 상자 폭(`rectWidth`)에 맞춰 띄어쓰기에서
  끊는다. 폭보다 긴 한 단어는 한중일만 글자 단위로 끊고 라틴 단어는 넘치게 둔다(글꼴 폭이 AutoCAD와 달라 단어
  중간을 자르면 더 나쁘다). OffscreenCanvas가 없으면 어림 폭을 쓴다.
- 선종류의 글자 요소("HW" 같은 것, `lib/build.ts alongLine`)는 선을 따라 무늬 주기마다 놓는다. 도형 요소(shx)는 못 그린다.
- 3D 입체(3DSOLID)는 ACIS 데이터에서 뽑은 모서리를 위에서 본 모양으로 그린다. 면은 없다(아래 "3D"). R2004 이후
  파일의 입체는 이진(SAB) 형식이라 라이브러리가 문자열로 못 넘겨 모서리가 안 나온다 — R14·2000 파일만 된다.
- 그리지 않는 것: POINT(PDMODE 0이면 점 하나), WIPEOUT(그리기 순서 표 SORTENTS가 없어 가리기를 재현하면
  멀쩡한 선을 지울 수 있다), IMAGE·OLE2FRAME(그림 데이터가 파일 밖에 있다). 화면 오른쪽 아래에 종류와 개수를 보여준다.

뷰어 기능: 글자 검색(Enter 다음, Shift+Enter 이전, Esc로 끝내면 단축키가 다시 듣는다), 측정(점 클릭, 끝점 자동
붙음, Esc), 클릭으로 엔티티 정보(종류·레이어·블록·길이·면적·속성값 — 고르는 순간 계산해 state에 둔다), 레이어
필터·전체 켜기/끄기·색 표시, 흰 배경, +/−/0 단축키와 화살표 이동, 드래그 앤 드롭(DWG·DXF가 아닌 파일은 "지원하지 않는
형식"으로 알린다), 용지 크기(A4~A0)·색 유지·PNG 크기 옵션. 그릴 것이 하나도 없는 파일(깨진 파일을 라이브러리가 빈 도면으로
읽은 경우 포함)은 실패로 다뤄 이전 도면을 지운다.

## 언어

화면은 본체와 같은 20개 언어다(`lib/i18n.ts` 한 파일). 주소는 `docmoa.com/cad/view`,
`docmoa.com/cad/view/<로케일>`. 20개 경로를 전부 정적으로 굽는다.

**공개 주소와 앱 내부 경로를 반드시 같게 둘 것.** 한동안 `docmoa.com/<로케일>/cad`를 이 앱의
`/cad/<로케일>`로 넘겼는데, 하이드레이션이 끝나면 Next 라우터가 제 경로대로 URL을 되돌려
일본어로 들어온 사람이 영어 화면을 보는 일이 있었다. 상태 코드로는 안 잡히고 브라우저에서만 보인다.

검색에 걸려야 하는 쪽은 본체 랜딩(`docmoa.com/cad`)이다. 이 앱은 `robots: noindex`에
canonical만 랜딩으로 걸어둔다. 광고·롱폼 카피·nav는 전부 랜딩이 갖는다(GPL 경계도 그래서 깔끔하다).

도면 텍스트 인코딩(CP949 등)은 libredwg가 `$DWGCODEPAGE`를 보고 처리한다. 변환기가 텍스트를 XML
이스케이프하지 않아, 치수에 흔한 `<53>` 표기 하나로 도면 전체가 안 열렸다. `lib/dwg.ts`의
`repairXml`이 막는다.

## PDF 폰트

jsPDF 기본 폰트는 Latin-1뿐이라 나머지 문자가 전부 깨진다. 그래서 **도면에 실제로 쓰인 글자**를 보고
폰트 하나를 골라 심는다(`lib/export.ts`의 `pickFont`). 화면 언어가 아니라 도면 내용 기준이다 —
일본어 화면에서 한글 도면을 여는 일이 실제로 있다.

| 글자 | 폰트 | 크기 |
| --- | --- | --- |
| 라틴·키릴·그리스·베트남어 | Noto Sans | 0.5MB |
| 한글 | 나눔고딕 | 2MB |
| 가나(일본어) | Noto Sans JP | 5MB |
| 한자 | Noto Sans SC / TC / JP / 나눔고딕 | 7~10MB |
| 태국어 | Noto Sans Thai | 45KB |
| 아랍어 | Noto Sans Arabic | 0.2MB |
| 데바나가리 | Noto Sans Devanagari | 0.2MB |

- 전부 OFL이고 `public/fonts/`에 같이 둔다. PDF 버튼을 누를 때만 받고, 한 번 받으면 캐시된다.
- 한자는 글자만 봐서는 간체/번체/일본 한자를 못 가른다. 화면 언어를 힌트로 쓴다. 가나 없이 한자만
  쓴 일본 도면을 다른 언어 화면에서 열면 간체 폰트가 걸린다(`tests/font.test.mts`에 적어뒀다).
- jsPDF가 쓰인 글자만 추려 담으므로, 10MB짜리 폰트를 써도 결과 PDF는 수백 KB다.
- **한 도면에 여러 문자가 섞이면 폰트는 하나만 고른다.** 나머지 문자는 깨진다.
- **아랍어·데바나가리는 글자 모양 결합(shaping)을 하지 않는다.** jsPDF에 그 기능이 없어 글자가
  따로 떨어져 나오고, 아랍어는 좌우 순서도 뒤집히지 않는다. 화면 표시는 정상, PDF만 그렇다.

## 3D

도면에 3차원 형상이 있으면 "3D 보기" 버튼이 뜬다.

- `3DFACE` → 삼각형 면으로 그린다.
- `POLYLINE3D` → 3D 선으로 그린다.
- `3DSOLID` → 안에 들어 있는 ACIS(SAT) 데이터에서 **모서리만** 뽑아 와이어프레임으로 그린다
  (`lib/sat.ts`). 라이브러리가 `data`에 WASM 메모리 주소를 담아두므로, 메모리를 해제하기 전에
  문자열로 읽어야 한다 — `readCad`가 그 순서를 지킨다. 같은 모서리를 2D 도면에도 위에서 본 모양으로 그린다.
  ACIS 헤더는 보통 3줄이지만 R14 파일은 1줄이라, 글자로 시작하는 첫 줄부터 레코드로 읽는다.

꽉 찬 입체를 음영까지 넣어 그리려면 곡면을 잘라 삼각형으로 쪼개야 하고(트리밍·테셀레이션)
그건 CAD 커널 한 벌이 필요하다. 하지 않는다. 그래서 원기둥·원뿔처럼 면이 곡면뿐인 형상은
모서리 원만 보인다. 화면에 그 사실을 안내한다.

지원하는 모서리 곡선은 `straight-curve`와 `ellipse-curve`다. `intcurve`(스플라인)는 못 그리고,
몇 개를 못 그렸는지 화면에 표시한다.

## 라이선스·상표

- 이 앱: GPL-3.0-or-later(`LICENSE`). 뷰어 헤더의 "GPL-3.0 · Source" 링크가 이 저장소를 가리킨다(GPL이 요구하는
  소스 제공). 포함한 WASM은 [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web) 0.7.14(GPL-3,
  [LibreDWG](https://www.gnu.org/software/libredwg/) 기반)이고, DXF 파서 @mlightcad/dxf-json(GPL-3)도 같은 저자다.
  **버전을 올리면 그 버전의 소스가 공개돼 있는지 확인할 것** — 배포하는 바이너리와 같은 소스를 가리켜야 한다. 지금 담긴
  WASM의 버전 문자열은 `LibreDWG 0.13.3.7825.246_0c9ab_dirty`(커밋 0c9ab에 미커밋 수정이 있는 빌드)라, 정확히 같은 소스를
  우리가 보관하고 있지는 않다(npm 패키지에도 gitHead가 없다; dxf-json 1.2.8은 `a94d49c`). GPL §6(d)의 "소스 위치 안내"는
  위 저장소 링크로 하고, 요구가 오면 그 저장소에서 받아 전달한다. 다음 라이브러리 업그레이드 때는 고정 커밋에서 직접 빌드할 것.
- three.js·jsPDF·Next·React는 MIT. 폰트 8종은 OFL 1.1(`public/fonts/OFL.txt`).
- "DWG", "AutoCAD"는 Autodesk, Inc.의 상표다. 파일 형식을 가리키는 설명적 사용만 하고 로고·제품명처럼 쓰지 않는다.
  뷰어의 빈 화면 안내문 아래에 상표 고지("DWG and AutoCAD are registered trademarks of Autodesk, Inc.")를 둔다.
  본체 랜딩(`docmoa.com/cad`)에도 같은 한 줄을 둘 것.
- `tests/fixtures/`의 `sample_2018.dwg`·`example_r14.dwg`는 LibreDWG 테스트 데이터(GPL-3)이고, `ezdxf_*.dxf`·`ko_notes_2018.dxf`는 ezdxf로 직접 만든 것이다.
  **실제 도면은 어떤 것도 저장소에 넣지 않는다** — 공개 GPL 저장소라 작성사의 저작권·기밀을 침해한다.

## 알려진 한계

- **SHX·빅폰트 한글**: 글리프가 도면 파일 안에 없고 작성자 PC의 `.shx`에 있다. 어떤 뷰어도
  원본대로 못 그리며 대체 폰트로 근사한다. 인코딩(CP949) 깨짐은 라이브러리가 처리한다.
- **여러 덩어리로 흩어진 도면**: `fitBox`(`lib/scene.ts`)가 중앙값에서 한참 떨어진 것을 버리고 화면을
  맞추므로 일부가 잘릴 수 있다. 축소하면 보인다.
- **MTEXT 안에서 바뀌는 글꼴·크기·색**은 따르지 않는다(한 줄은 한 글꼴·한 크기).
- **선종류의 도형(shx) 요소**는 못 그린다. 글자 요소는 그린다.
- **쓰기 없음**: 이 빌드의 LibreDWG는 읽기 전용이다. 버전 변환(2018→2013)은 불가.
- **3D는 와이어프레임까지**: 위 "3D" 항목 참고.
- **PDF 속 아랍어·인도계 문자**: 위 "PDF 폰트" 항목 참고.
