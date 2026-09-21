// emscripten glue의 Node 전용 분기(ENVIRONMENT_IS_NODE)가 참조하는 내장 모듈.
// 브라우저에서는 그 분기가 실행되지 않으므로 번들러를 통과시키기만 하면 된다.
export default {};
