// Supabase 프로젝트 정보를 넣으세요 (Project Settings → API).
// 두 값이 비어 있으면 '데모 모드'로 실행됩니다. 데모 모드는 이 브라우저에만 저장되는 예시용입니다.
export const CONFIG = {
  SUPABASE_URL: 'https://qehezkmwoyshqybnsvdz.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_BCVOp1rKwrw5c4n424eyIg_m-hhqpB2',  // 공개용 키 (secret / service_role 키는 절대 넣지 마세요)
  TEAM_NAME: '착즙팀',
  LOGO: 'logo.png',       // 왼쪽 위 로고 이미지 (web 폴더 안 파일). 비우면 '착' 글자로 표시
  GOOGLE_LOGIN: true,     // 로그인 화면에 '구글로 로그인' 버튼 표시 (Supabase에서 Google 설정 필요, README 참고)
  GOOGLE_DOMAIN: '',      // 회사 구글 워크스페이스 도메인만 보이게 하려면 예: 'company.co.kr' (비우면 모든 구글 계정)
};
