-- ───────── 029. 대화 이모티콘 ─────────
-- 메시지에 이모티콘(그림)을 담는 칸. 값은 '묶음/이름' (예: 'weeki/good'), 그림은 앱의 /stickers/ 폴더에 있다.
alter table public.messages add column if not exists sticker text
  check (sticker is null or sticker ~ '^[a-z0-9-]+/[a-z0-9-]+$');
