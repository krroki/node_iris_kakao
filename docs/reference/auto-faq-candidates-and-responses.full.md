# 무명령어 자동 FAQ – 후보군별 응답 매핑(전체)
> 아래 목록은 후보군(ops/all TOP500)에서 수집된 `norm_key` 전체에 대해,
> “자동응답 intent로 분류할지 / 무시할지”와, 자동응답 시의 **발신 템플릿(placeholder)** 을 함께 보여준다.
> 실제 URL/제목/근거 문장은 런타임에 KB 조회로 채운다(추측 금지).

---

## 1. 오영몇
- count: 17
- room_count: 1
- sources: all
- example: 오영몇?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 2. 커뮤니티 방 여러개인데 n나만 해도 될까요 어디로 해야 할까요
- count: 16
- room_count: 2
- sources: all, ops
- example: 커뮤니티 방 여러개인데 1나만 해도 될까요 어디로 해야 할까요.
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 3. 업로드된 동영상에 제품 태그는 어떻게 달아야 하는지도 부탁드립니다
- count: 16
- room_count: 1
- sources: all, ops
- example: 업로드된 동영상에 제품 태그는 어떻게 달아야 하는지도 부탁드립니다
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 4. 고구마 먹는 춘식이 고구마 먹는 춘식이 고구마 먹는 춘식이 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 15
- room_count: 2
- sources: all
- example: @고구마 먹는 춘식이 @고구마 먹는 춘식이 @고구마 먹는 춘식이 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 5. 콘텐츠 생각이 안나는데 진짜 아무거나추천해주실분 게임은 실력으론 안돼요
- count: 14
- room_count: 1
- sources: all, ops
- example: 콘텐츠 생각이 안나는데 진짜 아무거나추천해주실분 게임은 실력으론 안돼요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 6. 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 13
- room_count: 3
- sources: all
- example: @🌞 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- example: @ㅁㅁ 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- example: @ㅎ 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 7. 잘난체하는 어피치 잘난체하는 어피치 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 12
- room_count: 2
- sources: all
- example: @잘난체하는 어피치 @잘난체하는 어피치 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 8. 강요가안돼
- count: 12
- room_count: 1
- sources: all, ops
- example: 강요가안돼...
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 9. 굿굿
- count: 12
- room_count: 1
- sources: all
- example: 굿굿 ??
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 10. 안녕하세요 혹시 오늘 디하클상담이 안되는걸까요 어디로 문의해야하나요
- count: 12
- room_count: 1
- sources: all, ops
- example: 안녕하세요. 혹시 오늘 디하클상담이 안되는걸까요? 어디로 문의해야하나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 11. 오이가 들어오면 안되는집에 들어와서
- count: 12
- room_count: 1
- sources: all, ops
- example: 오이가 들어오면 안되는집에 들어와서
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 12. 우리 지금 결제하는거 없을텐데
- count: 12
- room_count: 1
- sources: all, ops
- example: 우리 지금 결제하는거 없을텐데 ?
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 13. 하트스샷은 어떻게 해요
- count: 12
- room_count: 1
- sources: all, ops
- example: 하트스샷은 어떻게 해요?
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 14. 안녕하세요 초대해주셔서 감사합니다
- count: 11
- room_count: 1
- sources: all
- example: 안녕하세요 초대해주셔서 감사합니다
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 15. 어서오세요 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다
- count: 11
- room_count: 1
- sources: all
- example: @! 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!
- example: 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!
- example: @磨斧作針🍀 @まえむき 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 16. 가만 생각해 보이 링센세는 이번 쿼드러플 강의 듣고 안정화 시키면 안되나 지금도 마이너스라고
- count: 10
- room_count: 1
- sources: all, ops
- example: ..........................( 가만 생각해 보이 링센세는 이번 쿼드러플...강의 듣고 안정화 시키면 안되나....지금도 마이너스라고??)
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 17. 결제 창이 안와요
- count: 10
- room_count: 1
- sources: all, ops
- example: 결제..창이 안와요
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 18. 그 여자피디님 질문 진짜 잘하심요 가려운곳 콕콕 찝으면서 실례 안되게 잘 물어봐주심
- count: 10
- room_count: 1
- sources: all, ops
- example: 그 여자피디님 질문 진짜 잘하심요. 가려운곳 콕콕 찝으면서 실례 안되게 잘 물어봐주심 ㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 19. 그건 구매랑 상관없나요
- count: 10
- room_count: 1
- sources: all, ops
- example: 그건 구매랑 상관없나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 20. 맘만 먹으면 방법은 아는 분이시군요
- count: 10
- room_count: 1
- sources: all, ops
- example: 맘만 먹으면 방법은 아는 분이시군요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 21. 언제하세요
- count: 10
- room_count: 1
- sources: all, ops
- example: 언제하세요 ㅎ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 22. 오이는 실온에 놔두면 안되지
- count: 10
- room_count: 1
- sources: all, ops
- example: 오이는 실온에 놔두면 안되지
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 23. 일단 인스타에서든 어디서든 수익이 나오고 있으면
- count: 10
- room_count: 1
- sources: all, ops
- example: 일단 인스타에서든 어디서든 수익이 나오고 있으면
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 24. 제가 글에 롱폼으로 영상 n개 n천만 사실 이보다 훨 많은데 코난방지용 n만 구독자 만들었다는건 요리쪽인데 이건 오리지널리티 있고 브랜딩 되고 다 좋은데 귀찮아서 운영을 못하겠더라고요
- count: 10
- room_count: 1
- sources: all
- example: 제가 글에 롱폼으로 영상 1개 1천만(사실 이보다 훨 많은데 코난방지용), 10만 구독자 만들었다는건 요리쪽인데 이건 오리지널리티 있고 브랜딩 되고 다 좋은데 귀찮아서 운영을 못하겠더라고요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 25. 지금 프사가 진짜 어디 가수 프사같긴함
- count: 10
- room_count: 1
- sources: all, ops
- example: 지금 프사가 진짜 어디 가수 프사같긴함
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 26. 찾아내는 거 방지용
- count: 10
- room_count: 1
- sources: all
- example: 찾아내는 거 방지용..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 27. 코난방지용이 뭔가요
- count: 10
- room_count: 1
- sources: all
- example: 코난방지용이 뭔가요?;;
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 28. 혹시 캡컷에서 선택영역만 내보내기 하는방법 아시는분
- count: 10
- room_count: 1
- sources: all, ops
- example: 혹시 캡컷에서 선택영역만 내보내기 하는방법 아시는분?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 29. 우는 춘식이 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 9
- room_count: 3
- sources: all
- example: @우는 춘식이 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 30. 에
- count: 9
- room_count: 1
- sources: all
- example: 에..?
- example: 에?!! 
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 31. 이거 할 시간에 이거하면 효율 더 좋은데 이러다가 결국 내가 하고싶은건 못하게되는 이런 딜레마가 있는거같습니다
- count: 9
- room_count: 1
- sources: all
- example: 이거 할 시간에 이거하면 효율 더 좋은데 이러다가 결국 내가 하고싶은건 못하게되는? 이런 딜레마가 있는거같습니다.
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 32. 채널 몇개 운영중이신가요
- count: 9
- room_count: 1
- sources: all
- example: 채널 몇개 운영중이신가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 33. 안돼요
- count: 8
- room_count: 2
- sources: all, ops
- example: 안돼요
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 34. 왜
- count: 8
- room_count: 2
- sources: all
- example: 왜?
- example: 왜ㅔ
- example: 왜 ?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 35. 유혹의손짓 어서오세요 하트스샷 부탁드립니다
- count: 8
- room_count: 2
- sources: all
- example: @유혹의손짓 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 36. 춤추는 어피치 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 8
- room_count: 2
- sources: all
- example: @춤추는 어피치 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 37. deep 답변이 안되네융
- count: 8
- room_count: 1
- sources: all, ops
- example: DEEP 답변이 안되네융
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 38. n시 반 넘어서 신청했는데 채널톡으로 카페 캡쳐해서 보내면 링크 받을 수 있나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 6시 반 넘어서 신청했는데 채널톡으로 카페 캡쳐해서 보내면 링크 받을 수 있나요????
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 39. pdf 복습 자료 어디서 받을수 있나요
- count: 8
- room_count: 1
- sources: all, ops
- example: Pdf 복습 자료 어디서 받을수 있나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 40. q i 종료 언제 하나요
- count: 8
- room_count: 1
- sources: all, ops
- example: Q&I 종료 언제.하나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 41. seol 저 무료강의보고있는데 저번에 튜브렌즈로 해외 영상 벤치마킹 그냥처럼 하면된다란말이죠 구독자 빠르게 모으는 방법 처럼
- count: 8
- room_count: 1
- sources: all, ops
- example: @Seol  저 무료강의보고있는데 저번에 튜브렌즈로  해외 영상  벤치마킹 그냥처럼 하면된다란말이죠 ? 구독자 빠르게 모으는 방법 ? 처럼 ㅋㅋ 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 42. 강의 자료어디서 받을수있나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 강의 자료어디서 받을수있나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 43. 강의 중간에 봐서 구입하고 픈데 어디다 입금해야하나요 입금하고 채널톡 드림 되나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 강의 중간에 봐서 구입하고 픈데 어디다 입금해야하나요 입금하고 채널톡 드림 되나요?
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 44. 강의날이 언제예요
- count: 8
- room_count: 1
- sources: all, ops
- example: 강의날이 언제예요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 45. 강의는 이 톡방에 링크가 생깁니까
- count: 8
- room_count: 1
- sources: all, ops
- example: 강의는 이 톡방에 링크가 생깁니까?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 46. 강의어디서 들어요
- count: 8
- room_count: 1
- sources: all, ops
- example: 강의어디서 들어요???
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 47. 검색에 재사용도 ok인 영상은 그대로 써도 되는건가요 아님 컷해서 써야 되는건가요 결제하고 처음써보는거라
- count: 8
- room_count: 1
- sources: all, ops
- example: 검색에 재사용도 ok인 영상은 그대로 써도 되는건가요? 아님 컷해서 써야 되는건가요 결제하고 처음써보는거라..
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 48. 공지 절차는 모두 수행한건가요
- count: 8
- room_count: 1
- sources: all, ops
- example: 공지 절차는 모두 수행한건가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 49. 괜히 어디 무슨 스탄 같은 곳이나
- count: 8
- room_count: 1
- sources: all, ops
- example: 괜히 어디.. 무슨 스탄.. 같은 곳이나..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 50. 구글은 마감되엇다고 뜨네요 이렇게하면되나요 카페가입은햇어요
- count: 8
- room_count: 1
- sources: all, ops
- example: 구글은 마감되엇다고 뜨네요 이렇게하면되나요 카페가입은햇어요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 51. 그거 pdf 받아서 햇느데 안되가지고
- count: 8
- room_count: 1
- sources: all, ops
- example: 그거 PDF 받아서 햇느데 안되가지고
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 52. 그니까 유튜브 배낀게아니고 어디서 소재를보고 내가 글을써서 민든거다 라고 주장을 해야하는건가요
- count: 8
- room_count: 1
- sources: all, ops
- example: 그니까 유튜브 배낀게아니고 어디서 소재를보고 내가 글을써서 민든거다 라고 주장을 해야하는건가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 53. 그치만 또 방법이 있겠죠 뭐
- count: 8
- room_count: 1
- sources: all, ops
- example: 그치만 또 방법이 있겠죠 뭐
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 54. 근데 그거도 방법이
- count: 8
- room_count: 1
- sources: all, ops
- example: 근데 그거도 방법이 ..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 55. 금광롱품 무료강의 언제 했나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 금광롱품 무료강의 언제 했나요?
- decision.intent: free_apply_recent_3
- decision.reason: KB_MENU_23_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 신청/공지 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 56. 나는언제 수익화 하려나유 강의를 좀들어봐야하나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 나는언제 수익화 하려나유 강의를 좀들어봐야하나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 57. 네 지난번 말씀드린 테크트리 처음 방법과 이번 무강 내용이 비슷하네요
- count: 8
- room_count: 1
- sources: all, ops
- example: 네, 지난번 말씀드린 테크트리 처음 방법과 이번 무강 내용이 비슷하네요 :)
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 58. 닉네임 반장 맞는데요
- count: 8
- room_count: 1
- sources: all, ops
- example: 닉네임 반장 맞는데요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 59. 닉네임 변경 부탁드립니당
- count: 8
- room_count: 1
- sources: all
- example: 닉네임 변경 부탁드립니당!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 60. 다시보기 댓글 어떻게 다나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 다시보기 댓글 어떻게 다나요? 
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 61. 다시보기링크 좀 알려주시면 안될까요
- count: 8
- room_count: 1
- sources: all, ops
- example: 다시보기링크 좀 알려주시면 안될까요?
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 62. 닫는 방법을 모르겠네요
- count: 8
- room_count: 1
- sources: all, ops
- example: 닫는 방법을 모르겠네요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 63. 댓글이안되요
- count: 8
- room_count: 1
- sources: all, ops
- example: 댓글이안되요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 64. 돈 뿌리는 라이언 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 8
- room_count: 1
- sources: all
- example: @돈 뿌리는 라이언 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 65. 두달만에 n키로 뺀방법있는데
- count: 8
- room_count: 1
- sources: all, ops
- example: 두달만에 13키로 뺀방법있는데
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 66. 링밥님 언제 어디까지 올라가시나 보겠습니다
- count: 8
- room_count: 1
- sources: all, ops
- example: 링밥님 언제 어디까지 올라가시나 보겠습니다
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 67. 링밥쌤 n기 언제합니까
- count: 8
- room_count: 1
- sources: all, ops
- example: 링밥쌤 2기 언제합니까
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 68. 링크다 갔나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 링크다 갔나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 69. 메일에 링크가 없는데 어디로 들어가야하나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 메일에 링크가 없는데 어디로 들어가야하나요?
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 70. 무료강의링크는어디있나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 무료강의링크는어디있나요
- decision.intent: free_apply_recent_3
- decision.reason: KB_MENU_23_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 신청/공지 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 71. 무료특강자료신청 어디서해요
- count: 8
- room_count: 1
- sources: all, ops
- example: 무료특강자료신청 어디서해요?
- decision.intent: free_apply_recent_3
- decision.reason: KB_MENU_23_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 신청/공지 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 72. 무방 주소 어디서 받나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 무방 주소 어디서 받나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 73. 박대표 어서오세요 하트스샷 부탁드립니다
- count: 8
- room_count: 1
- sources: all
- example: @박대표 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 74. 방법이
- count: 8
- room_count: 1
- sources: all, ops
- example: 방법이 
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 75. 배운스킬에만 매몰되면 절대 안되는데
- count: 8
- room_count: 1
- sources: all, ops
- example: 배운스킬에만 매몰되면 절대 안되는데ㅠㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 76. 사주 무료가의 후기 어디에 보내나요 폼은 또 어디서 작성하는지 알려주세요
- count: 8
- room_count: 1
- sources: all, ops
- example: 사주 무료가의 후기 어디에 보내나요? 폼은 또 어디서 작성하는지 알려주세요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 77. 살면서 언제 제가 몇천명 앞에서 얘기해보겠어요
- count: 8
- room_count: 1
- sources: all, ops
- example: 살면서 언제 제가 몇천명 앞에서 얘기해보겠어요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 78. 선배님들 질문 있습니다 ai 구독 할려고 서치 중에 여러 프로 그램을 모아서 한번 결제로 몯두 사용이 가능한 사이트픞 찾았어요 힉스 ai 라는건데 요거 결제하는게 더 경제적일 까요 여러개를 한번결제에 되는 만큼 성능이 떨어지는 걸까요 문의 드려요
- count: 8
- room_count: 1
- sources: all, ops
- example: 선배님들 질문 있습니다.   ai 구독 할려고 서치 중에  여러 프로 그램을 모아서  한번 결제로 몯두 사용이 가능한 사이트픞 찾았어요 .  힉스 ai 라는건데..  요거 결제하는게 더 경제적일 까요?    여러개를 한번결제에 되는 만큼 성능이 떨어지는 걸까요?  문의 드려요~^^
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 79. 수익창출 요건이 됐는데 이런 이유 때문에 수창이 안되고 있습니다
- count: 8
- room_count: 1
- sources: all, ops
- example: 수익창출 요건이 됐는데 이런 이유 때문에 수창이 안되고 있습니다 ㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 80. 스레드는 자동dm 안되죠
- count: 8
- room_count: 1
- sources: all, ops
- example: 스레드는 자동DM 안되죠
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 81. 슨생님들 혹시 프리랜서는 어디서 구하는게 좋은가요
- count: 8
- room_count: 1
- sources: all, ops
- example: 슨생님들 혹시 프리랜서는 어디서 구하는게 좋은가요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 82. 슬픈 어피치 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 8
- room_count: 1
- sources: all
- example: @슬픈 어피치 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 83. 시니어영상 댓글 달고 캡쳐 후 메일 보냈는데 아직 메일이 안와써요
- count: 8
- room_count: 1
- sources: all, ops
- example: 시니어영상 댓글 달고 캡쳐 후 메일 보냈는데 아직 메일이 안와써요. 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 84. 쓸데없는 인사 채팅봇 안하면 안되나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 쓸데없는 인사 채팅봇 안하면 안되나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 85. 아 안돼요
- count: 8
- room_count: 1
- sources: all, ops
- example: 아 안돼요 ㅋㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 86. 아 이게 결제를 해도 한참을 기다려야 하는군요
- count: 8
- room_count: 1
- sources: all, ops
- example: 아 이게 결제를 해도 한참을 기다려야 하는군요 ?
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 87. 아니 그거 자동대댓글 저는 왜 안되나요
- count: 8
- room_count: 1
- sources: all, ops
- example: 아니 그거 자동대댓글 저는 왜 안되나요 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 88. 안녕하세요 디하클체널 답변이 늦어지는거 같은 데 언제쯤 답변을 받을 수 있을까요
- count: 8
- room_count: 1
- sources: all, ops
- example: 안녕하세요 디하클체널 답변이 늦어지는거 같은 데 언제쯤 답변을 받을 수 있을까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 89. 안녕하세요 링밥님 무강 입금하고 신청했습니다 채널톡 마비라니 언제 볼 수 있을지 모르겠네요
- count: 8
- room_count: 1
- sources: all, ops
- example: 안녕하세요 링밥님 무강 입금하고 신청했습니다 채널톡 마비라니 언제 볼 수 있을지 모르겠네요 ㅠㅠ
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 90. 어서오세요 하트스샷 부탁드립니다
- count: 8
- room_count: 1
- sources: all
- example: 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 91. 왜이러지
- count: 8
- room_count: 1
- sources: all
- example: 왜이러지 ㅜㅠ
- example: 왜이러지..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 92. 유튜브 스튜디오 콘텐츠에서 수정가능합니다
- count: 8
- room_count: 1
- sources: all
- example: 유튜브 스튜디오 콘텐츠에서 수정가능합니다!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 93. 제품 태그하고 타임스탬프 추가해야 하는건가요
- count: 8
- room_count: 1
- sources: all
- example: 제품 태그하고 타임스탬프 추가해야 하는건가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 94. 티비 보는 라이언 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 8
- room_count: 1
- sources: all
- example: @티비 보는 라이언 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 95. 혹시 영상에 목소리가 꼭 들어가야하는 이유가 있을까요 그냥 자막 노래만 하면 효율이 없을까요
- count: 8
- room_count: 1
- sources: all
- example: 혹시 영상에 목소리가 꼭 들어가야하는 이유가 있을까요?그냥 자막 노래만 하면 효율이 없을까요?
- example: ?혹시 영상에 목소리가 꼭 들어가야하는 이유가 있을까요?그냥 자막 노래만 하면 효율이 없을까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 96. 게임은 저도 흑흑 시간이 없어서 못하구 있네요
- count: 7
- room_count: 1
- sources: all
- example: ㅠㅠ게임은 저도.. 흑흑 시간이 없어서 못하구 있네요..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 97. 대본 일케 쓰는거 맞아요
- count: 7
- room_count: 1
- sources: all
- example: 대본 일케 쓰는거 맞아요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 98. 상담하는 죠르디 어서오세요 닉네임변경이랑 하트스샷 부탁드립니다
- count: 7
- room_count: 1
- sources: all
- example: @상담하는 죠르디 어서오세요~ 닉네임변경이랑 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 99. 아
- count: 6
- room_count: 2
- sources: all
- example: 아?ㅋㅋㅋㅋㅋㅋ
- example: 아???????
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 100. canva 는 왜여
- count: 6
- room_count: 1
- sources: all
- example: canva 는 왜여 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 101. iris 님 어서오세요 소통하기 편한 닉네임 변경과 하트 스샷 부탁드립니다
- count: 6
- room_count: 1
- sources: all
- example: @Iris 님 어서오세요~ 소통하기 편한 닉네임 변경과 하트 스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 102. ryan lying in bed ryan waving shy ryan 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 6
- room_count: 1
- sources: all
- example: @Ryan Lying In Bed @Ryan waving @Shy Ryan 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 103. 굿굿 이라고했어 지금
- count: 6
- room_count: 1
- sources: all
- example: 굿굿 이라고했어 지금 ??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 104. 그냥 그건 딱 수창 용도로만 쓰는게 나을듯
- count: 6
- room_count: 1
- sources: all
- example: 그냥 그건 딱 수창 용도로만 쓰는게 나을듯 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 105. 그냥 머라도 좀이라도 더 수익내고파서
- count: 6
- room_count: 1
- sources: all
- example: 그냥 머라도 좀이라도 더 수익내고파서?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 106. 기운빠질걸
- count: 6
- room_count: 1
- sources: all
- example: 기운빠질걸?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 107. 난 그래서 면역력 수치 안떨어진거라고 생각하거든
- count: 6
- room_count: 1
- sources: all
- example: 난 그래서 면역력 수치 안떨어진거라고 생각하거든?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 108. 다하셧어요
- count: 6
- room_count: 1
- sources: all
- example: 다하셧어요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 109. 롱폼 숏폼 다 하세요
- count: 6
- room_count: 1
- sources: all
- example: 롱폼 숏폼 다 하세요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 110. 루디야 어서오세요 하트스샷 부탁드립니다
- count: 6
- room_count: 1
- sources: all
- example: @루디야 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 111. 링밥님 영상은 몇초 정도에요 평균적으로요
- count: 6
- room_count: 1
- sources: all
- example: 링밥님 영상은 몇초 정도에요? 평균적으로요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 112. 발 밟아버린다
- count: 6
- room_count: 1
- sources: all
- example: 발 밟아버린다?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 113. 밥은 저녁 한끼만 드신다는거야
- count: 6
- room_count: 1
- sources: all
- example: 밥은 저녁 한끼만 드신다는거야?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 114. 보통 n초 내외
- count: 6
- room_count: 1
- sources: all
- example: 보통 20초 내외?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 115. 소재찾고 인스타캡션등등 작업 다해서 n분은 아니쥬 링밥님
- count: 6
- room_count: 1
- sources: all
- example: 소재찾고 인스타캡션등등 작업 다해서 15분은 아니쥬 링밥님..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 116. 악플달리는건 괜찮고 신고당하는건 최악인거죠
- count: 6
- room_count: 1
- sources: all
- example: 악플달리는건 괜찮고 신고당하는건 최악인거죠?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 117. 어떤거 하려구여
- count: 6
- room_count: 1
- sources: all
- example: 어떤거 하려구여 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 118. 엄청 복잡하고 오래 걸릴텐데
- count: 6
- room_count: 1
- sources: all
- example: 엄청 복잡하고 오래 걸릴텐데 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 119. 왜웃어요
- count: 6
- room_count: 1
- sources: all
- example: 왜웃어요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 120. 우리 미리캔버스 맞아
- count: 6
- room_count: 1
- sources: all
- example: 우리 미리캔버스 맞아?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 121. 이거 그냥 단톡방에서 같이 얘기해봐도 될거같은뎅
- count: 6
- room_count: 1
- sources: all
- example: 이거 그냥 단톡방에서 같이 얘기해봐도 될거같은뎅 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 122. 이거 아냐
- count: 6
- room_count: 1
- sources: all
- example: 이거 아냐 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 123. 일잘하네
- count: 6
- room_count: 1
- sources: all
- example: 일잘하네?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 124. 작성해야되지
- count: 6
- room_count: 1
- sources: all
- example: 작성해야되지?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 125. 제가 염탐하는 채널이 쇼츠 태그 뭐 달앗는지 확인하는 사이트 있나요
- count: 6
- room_count: 1
- sources: all
- example: 제가 염탐하는 채널이 쇼츠 태그 뭐 달앗는지 확인하는 사이트 있나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 126. 진짜요
- count: 6
- room_count: 1
- sources: all
- example: 진짜요?
- example: 진짜요?!!
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 127. 축하하는 춘식이 어서오세요 닉네임변경이랑 하트스샷 부탁드립니다
- count: 6
- room_count: 1
- sources: all
- example: @축하하는 춘식이 어서오세요~ 닉네임변경이랑 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 128. 편집이게 다에요
- count: 6
- room_count: 1
- sources: all
- example: 편집이게 다에요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 129. 표지
- count: 6
- room_count: 1
- sources: all
- example: 표지 ?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 130. 프로필 이미지 하나 만드는데 한달 결제하는것도 애매하니까
- count: 6
- room_count: 1
- sources: all
- example: 프로필 이미지 하나 만드는데 한달 결제하는것도 애매하니까
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 131. 김두부 어서오세요 하트스샷 부탁드립니다
- count: 5
- room_count: 2
- sources: all
- example: @김두부 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 132. 반가워하는 프렌즈 반가워하는 프렌즈 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 5
- room_count: 2
- sources: all
- example: @반가워하는 프렌즈 @반가워하는 프렌즈 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 133. 변경했습니다
- count: 5
- room_count: 2
- sources: all
- example: 변경했습니다😊
- example: 변경했습니다~~
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 134. 얼굴 부비는 라이언 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 5
- room_count: 2
- sources: all
- example: @얼굴 부비는 라이언 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 135. 초대 감사합니다
- count: 5
- room_count: 2
- sources: all
- example: 초대 감사합니다 :)
- example: 초대 감사합니다
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 136. 축하하는 라이언 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 5
- room_count: 2
- sources: all
- example: @축하하는 라이언 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 137. 하트 든 춘식이 하트 든 춘식이 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 5
- room_count: 2
- sources: all
- example: @하트 든 춘식이 @하트 든 춘식이 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 138. n대인데여
- count: 5
- room_count: 1
- sources: all
- example: 30대인데여..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 139. pdf도 수정가능하지 않나
- count: 5
- room_count: 1
- sources: all
- example: pdf도 수정가능하지 않나 ㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 140. 가능할듯
- count: 5
- room_count: 1
- sources: all
- example: 가능할듯
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 141. 걍 그쪽에서 우연히 몇백만짜리가 몇개 터져가지고
- count: 5
- room_count: 1
- sources: all
- example: 걍 그쪽에서 우연히? 몇백만짜리가 몇개 터져가지고
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 142. 곤듀님 쌩얼에 안경인데 왜 예쁘시나요
- count: 5
- room_count: 1
- sources: all
- example: 곤듀님 쌩얼에 안경인데 왜 예쁘시나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 143. 그 n개 릴스를 유튭 수창계정 n개에 찢어서 업로드를 했어요
- count: 5
- room_count: 1
- sources: all
- example: 그 3개 릴스를 유튭 수창계정 3개에 찢어서 업로드를 했어요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 144. 그냥바쁘신거지않을까요
- count: 5
- room_count: 1
- sources: all
- example: 그냥바쁘신거지않을까요 ..? 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 145. 그래서 거의 영상업로드 빈도는 비슷했는데
- count: 5
- room_count: 1
- sources: all
- example: 그래서 거의 영상업로드...빈도는 비슷했는데
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 146. 그래서 저는 모르는돈 없는돈 생각하고 존버도 아니고 잊는게 좋은거 같아요 투자는 성향에 맞지도 않구 히히히
- count: 5
- room_count: 1
- sources: all
- example: 그래서 저는 모르는돈 없는돈 생각하고 존버도 아니고 잊는게 좋은거 같아요 투자는 성향에 맞지도 않구 히히히
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 147. 근데 점심에 항상 산에가시자나
- count: 5
- room_count: 1
- sources: all
- example: 근데 점심에 항상 산에가시자나?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 148. 긁적이는 춘식이 긁적이는 춘식이 긁적이는 춘식이 안녕하세요 기본 닉네임 변경 부탁드려요오
- count: 5
- room_count: 1
- sources: all
- example: @긁적이는 춘식이 @긁적이는 춘식이 @긁적이는 춘식이 안녕하세요~!ㅎㅎ 기본 닉네임 변경 부탁드려요오~
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 149. 긁적이는 춘식이 행복한 춘식이 기본닉네임이신분들 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다 미변경시 정리됩니다
- count: 5
- room_count: 1
- sources: all
- example: @긁적이는 춘식이 @행복한 춘식이 기본닉네임이신분들~~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다! 미변경시 정리됩니다 ㅠ.ㅠ
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 150. 나 일하러가는거지 놀러가는거 아니다
- count: 5
- room_count: 1
- sources: all
- example: 나 일하러가는거지 놀러가는거 아니다?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 151. 노래하는 춘식이 노래하는 춘식이 노래하는 춘식이 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @노래하는 춘식이 @노래하는 춘식이 @노래하는 춘식이 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 152. 노래하는 춘식이 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @노래하는 춘식이 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 153. 누워있는 죠르디 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @누워있는 죠르디 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 154. 다람쥐 좋아하신담서 까먹음
- count: 5
- room_count: 1
- sources: all
- example: ????  다람쥐 좋아하신담서 까먹음???  ㅇ.ㅇ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 155. 다른 카페가면 신으로 추앙받습니다 바로
- count: 5
- room_count: 1
- sources: all
- example: 다른 카페가면 신으로 추앙받습니다 바로 ㅋㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 156. 드릴까요
- count: 5
- room_count: 1
- sources: all
- example: 드릴까요?ㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 157. 똑똑 계세요
- count: 5
- room_count: 1
- sources: all
- example: 똑똑!!!! 계세요??? ㅇ.ㅇ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 158. 뜻이겠죠
- count: 5
- room_count: 1
- sources: all
- example: 뜻이겠죠?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 159. 로고 없이 고화질로 다운로드 하는 기능은 튜브렌즈 라이트 에서는 안 되는 거야
- count: 5
- room_count: 1
- sources: all
- example: ?로고 없이 고화질로 다운로드 하는 기능은 튜브렌즈 라이트 에서는 안 되는 거야?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 160. 링밥님 pdf있는데
- count: 5
- room_count: 1
- sources: all
- example: 링밥님 pdf있는데 ㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 161. 링밥님 강의 이번주에 하세용
- count: 5
- room_count: 1
- sources: all
- example: 링밥님 강의 이번주에 하세용?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 162. 링밥이다 아모르다
- count: 5
- room_count: 1
- sources: all
- example: 링밥이다!!!! 아모르다!!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 163. 맛있었오
- count: 5
- room_count: 1
- sources: all
- example: 맛있었오 ??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 164. 먹고싶을때 머거서
- count: 5
- room_count: 1
- sources: all
- example: 먹고싶을때 머거서 ??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 165. 모두n 어서오세요 하트스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @모두7 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 166. 무강때 만들었던 ppt가 없네 요
- count: 5
- room_count: 1
- sources: all
- example: 무강때 만들었던 PPT가 없네...요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 167. 문제는 우리나라 사람들 거기까지 못 기다린다는거지
- count: 5
- room_count: 1
- sources: all
- example: 문제는 우리나라 사람들 거기까지 못 기다린다는거지
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 168. 물론 이게 더 양질의 컨텐츠를 냅다 그쪽으로 업로드 하는것도 있긴하지만
- count: 5
- room_count: 1
- sources: all
- example: 물론 이게 더 양질의 컨텐츠를 냅다 그쪽으로 업로드 하는것도 있긴하지만 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 169. 밥쌤 지금 들어가면 n n기 둘다 댄다구요
- count: 5
- room_count: 1
- sources: all
- example: 밥쌤 지금 들어가면 1.2기 둘다 댄다구요..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 170. 부자되고싶습니 어서오세요 하트스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @부자되고싶습니 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 171. 뽑기좀 있지 않아요
- count: 5
- room_count: 1
- sources: all
- example: 뽑기좀 있지 않아요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 172. 사랑에 빠진 죠르디 사랑에 빠진 죠르디 사랑에 빠진 죠르디 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @사랑에 빠진 죠르디 @사랑에 빠진 죠르디 @사랑에 빠진 죠르디 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 173. 살아온 환경차이가 크다 보니까 나는 삼시세끼 제때 챙겨먹는걸 중요시 하는 사람이자나
- count: 5
- room_count: 1
- sources: all
- example: 살아온 환경차이가 크다 보니까 나는 삼시세끼 제때 챙겨먹는걸 중요시 하는 사람이자나?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 174. 수창채널 구매해서 조회수 뽑는거랑 n에서 시작해서 직접 수창시켜서 조회수 뽑는거랑 개인의 역량이지 조회수 차이없는거죠
- count: 5
- room_count: 1
- sources: all
- example: 수창채널 구매해서 조회수 뽑는거랑, 0에서 시작해서 직접 수창시켜서 조회수 뽑는거랑 개인의 역량이지 조회수 차이없는거죠?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 175. 식보이 어서오세요 하트스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @식보이 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 176. 썰님 튜브렌즈 프로그램 사용 할 예정인데 제미나이 프로 사용중인데 이게 연동을 하게 되면 자동으로 프로로 사용 되나요
- count: 5
- room_count: 1
- sources: all
- example: 썰님 튜브렌즈 프로그램 사용 할 예정인데 제미나이 프로 사용중인데 이게 연동을 하게 되면 자동으로 프로로 사용 되나요??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 177. 아 그래요 다시 눌러봐야징 근데 인터뷰하시는 목소리도 여자피디님 아니셨어요
- count: 5
- room_count: 1
- sources: all
- example: 아 그래요??? 다시 눌러봐야징. 근데 인터뷰하시는 목소리도 여자피디님 아니셨어요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 178. 아 그러고보니 주원님은 얼공이시지
- count: 5
- room_count: 1
- sources: all
- example: 아 그러고보니 주원님은 얼공이시지?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 179. 아 근데 은곤쥬 곤쥬님 저 질문해도 되나요
- count: 5
- room_count: 1
- sources: all
- example: 아 근데 @은곤쥬 곤쥬님 저 질문해도 되나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 180. 아 피드가 왔다갔다 하는거죠
- count: 5
- room_count: 1
- sources: all
- example: 아 피드가 왔다갔다 하는거죠?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 181. 아니 이럴슈갘
- count: 5
- room_count: 1
- sources: all
- example: ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ아니?!이럴슈갘ㅋㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 182. 아닐걸요
- count: 5
- room_count: 1
- sources: all
- example: 아닐걸요..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 183. 아직 결제창 못받았어요
- count: 5
- room_count: 1
- sources: all
- example: 아직 결제창 못받았어요
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 184. 아직 못받음
- count: 5
- room_count: 1
- sources: all
- example: 아직 못받음 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 185. 악플에도 하트 눌러줍니다
- count: 5
- room_count: 1
- sources: all
- example: 악플에도 하트 눌러줍니다
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 186. 안녕하세요 초대감사합니다
- count: 5
- room_count: 1
- sources: all
- example: 안녕하세요^^ 초대감사합니다
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 187. 앙모르형이 그렇게말씀하시면
- count: 5
- room_count: 1
- sources: all
- example: 앙모르형이 그렇게말씀하시면 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 188. 양산형채널이 뭐에요
- count: 5
- room_count: 1
- sources: all
- example: 양산형채널이 뭐에요..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 189. 어제 줌에서도 반짝반짝 하셨어요
- count: 5
- room_count: 1
- sources: all
- example: 어제 줌에서도 반짝반짝 하셨어요!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 190. 역시 디하클 가입한 이유 중 하나도 주변에 유튜브 하는 사람이 없어요 직장동료 친척 친구 선후배 n명가까이 되는 사람 중에 아무도 안하다니
- count: 5
- room_count: 1
- sources: all
- example: 역시 디하클 가입한 이유 중 하나도 주변에 유튜브 하는 사람이 없어요, 직장동료, 친척, 친구, 선후배 100명가까이 되는 사람 중에 아무도 안하다니.. 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 191. 영상은 꾸준히 업로드 했거든요
- count: 5
- room_count: 1
- sources: all
- example: 영상은 :꾸준히 업로드 했거든요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 192. 오 아모르형 이제 작곡까지
- count: 5
- room_count: 1
- sources: all
- example: 오 아모르형 이제 작곡까지?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 193. 오때또
- count: 5
- room_count: 1
- sources: all
- example: 오때또 ?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 194. 오이를 왜 실온에놔둬
- count: 5
- room_count: 1
- sources: all
- example: 오이를 왜 실온에놔둬....?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 195. 왜 뭐 할말있낭
- count: 5
- room_count: 1
- sources: all
- example: 왜 ? 뭐 할말있낭 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 196. 왜요
- count: 5
- room_count: 1
- sources: all
- example: 왜요 ??
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 197. 왠지 ai 한테 pdf주고 이거 ppt로 만들어줘 하는게 있을것만 같은
- count: 5
- room_count: 1
- sources: all
- example: 왠지 ai 한테 pdf주고 이거 ppt로 만들어줘~ 하는게 있을것만 같은
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 198. 원래그런거같아요
- count: 5
- room_count: 1
- sources: all
- example: 원래그런거같아요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 199. 이거 인가요
- count: 5
- room_count: 1
- sources: all
- example: 이거 인가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 200. 이것도 유튜브 정책에 따라 어찌될지 모르긴 합니다
- count: 5
- room_count: 1
- sources: all
- example: 이것도 유튜브 정책에 따라 어찌될지 모르긴 합니다
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 201. 이래되고 뭐가 문제인지 모르겠어요
- count: 5
- room_count: 1
- sources: all
- example: 이래되고 뭐가 문제인지 모르겠어요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 202. 이렇게 하는건사요
- count: 5
- room_count: 1
- sources: all
- example: 이렇게 하는건사요??;;;;;;
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 203. 이렇게나 차이날 일인가 싶긴하거든요
- count: 5
- room_count: 1
- sources: all
- example: 이렇게나 차이날 일인가? 싶긴하거든요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 204. 이브 어서오세요 하트스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @이브 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 205. 일단 닉네임부터
- count: 5
- room_count: 1
- sources: all
- example: 일단 닉네임부터 ...
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 206. 잘 나왔을랑가 모르겠네
- count: 5
- room_count: 1
- sources: all
- example: 잘 나왔을랑가 모르겠네
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 207. 저 지금 편집이 사실 한 n분 정도 걸리거든요
- count: 5
- room_count: 1
- sources: all
- example: 저 지금 편집이 사실 한...15분? 정도 걸리거든요 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 208. 저게뭐죠
- count: 5
- room_count: 1
- sources: all
- example: 저게뭐죠??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 209. 저는 최근에 거래소 접속 기억 못해서
- count: 5
- room_count: 1
- sources: all
- example: 저는 최근에 거래소 접속 기억 못해서
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 210. 저요
- count: 5
- room_count: 1
- sources: all
- example: 저요?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 211. 저희 부모님도 저 유튜브하는거 모르십니다
- count: 5
- room_count: 1
- sources: all
- example: 저희 부모님도 저 유튜브하는거 모르십니다 ㅎㅎ..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 212. 제 실물보다 잘 나온 그런
- count: 5
- room_count: 1
- sources: all
- example: 제 실물보다 잘 나온 그런 .. ?!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 213. 주변에 주식하는 사람들이 없어서 팬딩 서비스 가입중인데요 디하클도 팬딩서비스 하면 좋겠다 싶었지만 다시 든 생각이 카페로 큰 곳이니까 정체성을 위해서 카페가 더 나은것 같다고 생각하믄서 디하클을 조금이라도 한번 생각해 본 계기가 되었습니다
- count: 5
- room_count: 1
- sources: all
- example: 주변에 주식하는 사람들이 없어서 팬딩 서비스 가입중인데요, 디하클도 팬딩서비스 하면 좋겠다 싶었지만, 다시 든 생각이 카페로 큰 곳이니까 정체성을 위해서 카페가 더 나은것 같다고 생각하믄서 디하클을 조금이라도 한번 생각해 본 계기가 되었습니다^^
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 214. 지금 n시간 n만도 안나오네요 원인을 모르겠네요
- count: 5
- room_count: 1
- sources: all
- example: 지금 48시간 50만도 안나오네요. 원인을 모르겠네요;
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 215. 째려보는 어피치 어서오셔용 닉네임 변경 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @째려보는 어피치 어서오셔용~~ 닉네임 변경 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 216. 천무회장 님 어서오세요 소통하기 편한 닉네임 변경과 하트 스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @천무회장 님 어서오세요~ 소통하기 편한 닉네임 변경과 하트 스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 217. 크몽 같은곳에 의뢰햐서 저작권까지 인도받는거죠
- count: 5
- room_count: 1
- sources: all
- example: 크몽 같은곳에 의뢰햐서 저작권까지 인도받는거죠?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 218. 튜브렌즈 맥북에서 설치가 안 되는데 어떻게 해야돼
- count: 5
- room_count: 1
- sources: all
- example: ?튜브렌즈 맥북에서 설치가 안 되는데 어떻게 해야돼?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 219. 티비 보는 라이언
- count: 5
- room_count: 1
- sources: all
- example: @티비 보는 라이언 https://youtu.be/t5Z-Q1bg1tU?si=pmQQVDUubY7S6_lN
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 220. 티비 보는 라이언 티비 보는 라이언 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @티비 보는 라이언 @티비 보는 라이언 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다! 
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 221. 풍요속감사 어서오세요 하트스샷 부탁드립니다
- count: 5
- room_count: 1
- sources: all
- example: @풍요속감사 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 222. 피규어도 하나 못삿는데
- count: 5
- room_count: 1
- sources: all
- example: 피규어도 하나 못삿는데
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 223. 하면되나요
- count: 5
- room_count: 1
- sources: all
- example: 하면되나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 224. 한시 쯔 잉엿나
- count: 5
- room_count: 1
- sources: all
- example: 한시?쯔<ㅁ잉엿나
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 225. 할루아 달콤쌉쌀잔탱 어서오세요 두분 닉네임 기억나요오
- count: 5
- room_count: 1
- sources: all
- example: @할루아 @달콤쌉쌀잔탱 어서오세요~~ㅎㅎ 두분 닉네임 기억나요오~!! 
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 226. 해외 생활하고 하느라 또 귀차니즘이 심해 규모를 키우진 못했네요
- count: 5
- room_count: 1
- sources: all
- example: 해외 생활하고 하느라.. 또 귀차니즘이 심해 규모를 키우진 못했네요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 227. 혹시 튜브렌즈는 n개pc만 가능한가요
- count: 5
- room_count: 1
- sources: all
- example: 혹시 튜브렌즈는 1개pc만 가능한가요??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 228. ai콘텐츠분석누르니깐 스튜디오 api키 발급하라는데 어떻게 하나여
- count: 4
- room_count: 1
- sources: all
- example: AI콘텐츠분석누르니깐 스튜디오 API키 발급하라는데 어떻게 하나여?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 229. api 할당량 초과
- count: 4
- room_count: 1
- sources: all
- example: ? API 할당량 초과
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 230. bluekidn 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @bluekid1109 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 231. dbt 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @DBT👍 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 232. hj 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @Hj 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 233. lauren 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @Lauren 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 234. ml 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @ML 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 235. movie fix
- count: 4
- room_count: 1
- sources: all
- example: MOVIE FIX - https://youtube.com/@movie2fix?si=rtJfHtGknqSZZ2Cd
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 236. n n 프로필 닉네임
- count: 4
- room_count: 1
- sources: all
- example: 1:1 프로필.. 닉네임
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 237. n 왜케 많이 오는지
- count: 4
- room_count: 1
- sources: all
- example: 070 왜케 많이 오는지 ㄷㄷ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 238. n개요
- count: 4
- room_count: 1
- sources: all
- example: 8개요???
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 239. n명남기고 들어왓네요 하마터면 못들어올뻔
- count: 4
- room_count: 1
- sources: all
- example: 6명남기고 들어왓네요 하마터면 못들어올뻔
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 240. n번 가능하면 캡컷 배워보려구요
- count: 4
- room_count: 1
- sources: all
- example: 2번 가능하면 캡컷 배워보려구요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 241. n번인것 같은데요 보통 어느정도 시간을 두고 재시도 해보면 될까요
- count: 4
- room_count: 1
- sources: all
- example: 2번인것 같은데요. 보통 어느정도 시간을 두고 재시도 해보면 될까요~?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 242. n분만에 잠못드셨군요
- count: 4
- room_count: 1
- sources: all
- example: 2분만에 잠못드셨군요 ㅜㅜ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 243. n시 시작인가요
- count: 4
- room_count: 1
- sources: all
- example: 19시 시작인가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 244. n은 못벌겠죠 뭐
- count: 4
- room_count: 1
- sources: all
- example: 300은 못벌겠죠 뭐
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 245. n천캡 요청하신거 더 늘어나셨어요
- count: 4
- room_count: 1
- sources: all
- example: 3천캡 요청하신거 더 늘어나셨어요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 246. p s 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @P.S 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 247. pc 카톡에서 스크린샷 찍는 단축키 점 알려줘유
- count: 4
- room_count: 1
- sources: all
- example: PC 카톡에서 스크린샷 찍는 단축키 점 알려줘유 ~~
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 248. pc버전 카톡이면 채팅창에 세줄짜리 모양 아이콘 누르면 바로 하트 누르는게 보이는데
- count: 4
- room_count: 1
- sources: all
- example: pc버전 카톡이면 채팅창에 세줄짜리 모양 아이콘 누르면 바로 하트 누르는게 보이는데
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 249. pc에서 스크린샷 어떻게 찍나요
- count: 4
- room_count: 1
- sources: all
- example: PC에서 스크린샷 어떻게 찍나요 ~~ ?
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 250. sc 다니엘 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @SC 다니엘 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 251. scappy waving 사랑에 빠진 죠르디 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @Scappy Waving @사랑에 빠진 죠르디 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 252. sep 유토피아n 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @Sep @유토피아777 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 253. skyrunner 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @skyrunner 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 254. tts말씀하시는건가요
- count: 4
- room_count: 1
- sources: all
- example: TTS말씀하시는건가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 255. whitetext 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @WhiteText 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 256. yongjung 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @Yongjung 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 257. zorra 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @zorra 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 258. 가능
- count: 4
- room_count: 1
- sources: all
- example: 가능
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 259. 간식 먹는 프렌즈 어서오세요 닉네임변경이랑 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @간식 먹는 프렌즈 어서오세요~ 닉네임변경이랑 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 260. 간절한 앙몬드 부끄러운 앙몬드 어서오세요 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @간절한 앙몬드 @부끄러운 앙몬드 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 261. 감동받은 어피치 감동받은 어피치 어서오세요 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @감동받은 어피치 @감동받은 어피치 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 262. 감동받은 어피치 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @감동받은 어피치 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 263. 강사님들은 일케 닉네임 에다가 강의명 적으시면
- count: 4
- room_count: 1
- sources: all
- example: 강사님들은 일케,, 닉네임 에다가 강의명 적으시면,,
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 264. 강스테이 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @강스테이 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 265. 강의 못받은사람은 어찌하나여
- count: 4
- room_count: 1
- sources: all
- example: 강의 못받은사람은 어찌하나여ㅜㅜ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 266. 강의 사전 예약은 저도 모르겠네요
- count: 4
- room_count: 1
- sources: all
- example: 강의 사전 예약은 저도 모르겠네요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 267. 강의 어떤게 좋나여 추천받습니다
- count: 4
- room_count: 1
- sources: all
- example: 강의 어떤게 좋나여? 추천받습니다
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 268. 강의를 금요일이나 토요일밤에 해주시면 안될까요
- count: 4
- room_count: 1
- sources: all
- example: 강의를 금요일이나 토요일밤에 해주시면 안될까요 ㅠㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 269. 강의방 맞나요
- count: 4
- room_count: 1
- sources: all
- example: 강의방 맞나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 270. 개인을 하나 더파면 again
- count: 4
- room_count: 1
- sources: all
- example: 개인을 하나 더파면 AGAIN?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 271. 개인적인 생각으로 무강만 듣고 하시는건
- count: 4
- room_count: 1
- sources: all
- example: 개인적인 생각으로 무강만? 듣고 하시는건 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 272. 거절 사유가 뭔가요
- count: 4
- room_count: 1
- sources: all
- example: 거절 사유가 뭔가요..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 273. 건강여tv 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @건강여TV 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 274. 건당 n만원이면 하루에 하나 정도는 보험으로 할만한데
- count: 4
- room_count: 1
- sources: all
- example: 건당 10만원이면 하루에 하나 정도는 보험으로 할만한데?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 275. 결제관련 여쭤보려는데 아침 n시쯤 채널톡 드린게 아직 답이 없네요
- count: 4
- room_count: 1
- sources: all
- example: 결제관련 여쭤보려는데 아침 9시쯤 채널톡 드린게 아직 답이 없네요 ㅠㅠ
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 276. 결제는 안했는데
- count: 4
- room_count: 1
- sources: all
- example: 결제는 안했는데
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 277. 경과 확인 이전과 동일하게 항암하시는거면 제가 입원날도 다녀올까요
- count: 4
- room_count: 1
- sources: all
- example: 경과 확인 + 이전과 동일하게 항암하시는거면 제가 입원날도 다녀올까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 278. 경자 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @경자 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 279. 계정은 만들기쉬워요 나중에 인증만 하면되요
- count: 4
- room_count: 1
- sources: all
- example: 계정은 만들기쉬워요 나중에 인증만 하면되요 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 280. 고고희망 몰입러 꿀부업 시선 블루자이언트 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @고고희망 @몰입러 @꿀부업 @시선 @블루자이언트 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 281. 고구마 먹는 춘식이 고구마 먹는 춘식이 고구마 먹는 춘식이 고구마 먹는 춘식이 프렌즈 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @고구마 먹는 춘식이 @고구마 먹는 춘식이 @고구마 먹는 춘식이 @고구마 먹는 춘식이 @프렌즈 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 282. 고구마 먹는 춘식이 고구마 먹는 춘식이 긁적이는 춘식이 디하클 춘식 하트 든 춘식이 어서오세요 닉네임변경이랑 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @고구마 먹는 춘식이 @고구마 먹는 춘식이 @긁적이는 춘식이 @디하클 춘식 @하트 든 춘식이 어서오세요~ 닉네임변경이랑 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 283. 고구마 먹는 춘식이 고구마 먹는 춘식이 긁적이는 춘식이 박스에 들어간 춘식이 배부른 춘식이 우는 춘식이 우는 춘식이 축하하는 춘식이 하트 든 춘식이 기본닉네임이신분들 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다 미변경시 정리됩니다
- count: 4
- room_count: 1
- sources: all
- example: @고구마 먹는 춘식이 @고구마 먹는 춘식이 @긁적이는 춘식이 @박스에 들어간 춘식이 @배부른 춘식이 @우는 춘식이 @우는 춘식이 @축하하는 춘식이 @하트 든 춘식이 기본닉네임이신분들~~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다! 미변경시 정리됩니다 ㅠ.ㅠ
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 284. 고러면 그 이미지 는 영상 이 되지용
- count: 4
- room_count: 1
- sources: all
- example: 고러면 그 '이미지' 는 '영상' 이 되지용?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 285. 괌이요
- count: 4
- room_count: 1
- sources: all
- example: 괌이요?????????????
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 286. 괜찮으심
- count: 4
- room_count: 1
- sources: all
- example: 괜찮으심?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 287. 괜탐 나요
- count: 4
- room_count: 1
- sources: all
- example: 괜탐ㅎ나요??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 288. 구글 직원이 몰래쓰는 gpt 프롬프트 공개
- count: 4
- room_count: 1
- sources: all
- example: 구글 직원이 몰래쓰는 GPT 프롬프트 공개 - https://youtube.com/shorts/gaLx9gBMKyg?si=AnxAz3d1c-p_h-QP
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 289. 구글계정 여러개 만들때 그러면 핸드폰인증은 어떻게 하시나요
- count: 4
- room_count: 1
- sources: all
- example: 구글계정 여러개 만들때 그러면  핸드폰인증은 어떻게 하시나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 290. 구석 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @구석 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 291. 귀에때려박아줌
- count: 4
- room_count: 1
- sources: all
- example: 귀에때려박아줌
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 292. 그거때매 오줌못눠서 신부전 올수잇대서
- count: 4
- room_count: 1
- sources: all
- example: 그거때매 오줌못눠서 신부전 올수잇대서
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 293. 그게 뭔가요
- count: 4
- room_count: 1
- sources: all
- example: 그게 뭔가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 294. 그냥 수술도못하고
- count: 4
- room_count: 1
- sources: all
- example: 그냥... 수술도못하고
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 295. 그랑블루 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @그랑블루 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 296. 그래서 n기 언젠데요
- count: 4
- room_count: 1
- sources: all
- example: 그래서 2기 언젠데요?????????
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 297. 그래야되나
- count: 4
- room_count: 1
- sources: all
- example: 그래야되나
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 298. 그러니까요 그 n만원을 못 뽑아서 아직도 회사 목줄 메고 있습니다
- count: 4
- room_count: 1
- sources: all
- example: 그러니까요. 그 3만원을 못 뽑아서 아직도 회사 목줄 메고 있습니다. 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 299. 그러면 넘치는거는 못받는건가
- count: 4
- room_count: 1
- sources: all
- example: 그러면 넘치는거는 못받는건가..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 300. 그러면 차라리 풍경 사진 넣는게 나을까요
- count: 4
- room_count: 1
- sources: all
- example: 그러면 차라리 풍경 사진 넣는게 나을까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 301. 그런곳이 있어요
- count: 4
- room_count: 1
- sources: all
- example: 그런곳이 있어요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 302. 그런데 카페에는 댓글을 남길 권한이 없는걸로 뜨네요
- count: 4
- room_count: 1
- sources: all
- example: 그런데 카페에는 댓글을 남길 권한이 없는걸로 뜨네요 ㅠㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 303. 그럼 복사한거에 뻐끔뻐끔영상 합성 한거는 괜찮은건가요
- count: 4
- room_count: 1
- sources: all
- example: 그럼 복사한거에 뻐끔뻐끔영상 합성 한거는 괜찮은건가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 304. 그렇게는 잘 안 알려드립니다
- count: 4
- room_count: 1
- sources: all
- example: 그렇게는.. 잘 안 알려드립니다ㅠㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 305. 그리고 거기에 소리도 입히고 자막도 넣지용
- count: 4
- room_count: 1
- sources: all
- example: 그리고 거기에 소리도 입히고 자막도 넣지용?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 306. 그리고 튜브렌즈 월비용내고 쓰는거지요
- count: 4
- room_count: 1
- sources: all
- example: 그리고 튜브렌즈 월비용내고 쓰는거지요?^^
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 307. 근데 못줘
- count: 4
- room_count: 1
- sources: all
- example: 근데 못줘
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 308. 근데 밍밍밍밍 님은 재사용도 아니시자나요
- count: 4
- room_count: 1
- sources: all
- example: 근데 밍밍밍밍 님은 재사용도 아니시자나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 309. 근데 블프 온제하셔요
- count: 4
- room_count: 1
- sources: all
- example: 근데 블프 온제하셔요 ? 👀
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 310. 근데 지금 쿠팡이 n 내려가면 또 모르죠 뭐
- count: 4
- room_count: 1
- sources: all
- example: 근데 지금 쿠팡이 3% 내려가면 또..모르죠 뭐
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 311. 근데갈피를못잡구잇숨다
- count: 4
- room_count: 1
- sources: all
- example: 근데갈피를못잡구잇숨다 ㅠㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 312. 긁적이는 춘식이 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @긁적이는 춘식이 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 313. 기분이 조아 안조아
- count: 4
- room_count: 1
- sources: all
- example: 기분이 조아? 안조아?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 314. 김언니 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @김언니 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 315. 깽깽이 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @깽깽이 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 316. 나 진짜 아예 모르겠다
- count: 4
- room_count: 1
- sources: all
- example: 나 진짜 아예 모르겠다
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 317. 나간게 있는데 왜 안줄어드냐
- count: 4
- room_count: 1
- sources: all
- example: 나간게 있는데 왜 안줄어드냐 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 318. 나나리 아직 안나왔노
- count: 4
- room_count: 1
- sources: all
- example: 나나리 아직 안나왔노..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 319. 나른한 니니즈 나른한 프렌즈 나른한 프렌즈 어서오세요 닉네임변경이랑 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @나른한 니니즈 @나른한 프렌즈 @나른한 프렌즈 어서오세요~ 닉네임변경이랑 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 320. 나른한 니니즈 니니즈 응원하는 니니즈 춤추는 니니즈 자랑하는 라이언 하트를 든 라이언 파이팅하는 무지 슬픈 어피치 파티하는 어피치 기본닉네임이신분들 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다 미변경시 정리됩니다
- count: 4
- room_count: 1
- sources: all
- example: @나른한 니니즈 @니니즈 @응원하는 니니즈 @춤추는 니니즈 @자랑하는 라이언 @하트를 든 라이언 @파이팅하는 무지 @슬픈 어피치 @파티하는 어피치 기본닉네임이신분들~~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다! 미변경시 정리됩니다 ㅠ.ㅠ
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 321. 나른한 니니즈 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @나른한 니니즈 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 322. 나른한 프렌즈 어서오세요 닉네임변경 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @나른한 프렌즈 어서오세요~닉네임변경, 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 323. 나무 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @나무 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 324. 내일 아닌가요
- count: 4
- room_count: 1
- sources: all
- example: 내일 아닌가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 325. 내일은별 historymaker 김규상 n jinho 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @내일은별 @Historymaker @김규상 / 1310 @JinHo 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 326. 내일은별 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @내일은별 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 327. 너네집엔 인터넷 속도 뭐써
- count: 4
- room_count: 1
- sources: all
- example: 너네집엔 인터넷 속도 뭐써?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 328. 너무 쭈글쭈글해지지 않아도되나요 괜히 쭈글쭈글
- count: 4
- room_count: 1
- sources: all
- example: 너무 쭈글쭈글해지지 않아도되나요ㅜㅠㅎㅎㅎㅎ 괜히 쭈글쭈글ㅠㅠㅎㅎㅎ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 329. 너희도 롤드컵 봄
- count: 4
- room_count: 1
- sources: all
- example: 너희도 롤드컵 봄?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 330. 네 초대해 주셔서 감사합니다
- count: 4
- room_count: 1
- sources: all
- example: 네 초대해 주셔서 감사합니다 ^^
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 331. 네넹 오늘 바로가입하겠습니다 부수입 벌어야한다는 강박이 생겨서 너무급하게했네요 지금이라도 만나뵙게되서 행운이라생각합니다 열심히 잘해야죠
- count: 4
- room_count: 1
- sources: all
- example: 네넹 오늘 바로가입하겠습니다! 부수입 벌어야한다는 강박이 생겨서 너무급하게했네요..지금이라도 만나뵙게되서 행운이라생각합니다!열심히 잘해야죠ㅎㅎ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 332. 네오 네오 배불뚝 제이지 힙합맨 제이지 힙합맨 제이지 멍한 프렌즈 멍한 프렌즈 인사하는 프렌즈 인사하는 프렌즈 인사하는 프렌즈 기본닉네임이신분들 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다 미변경시 정리됩니다
- count: 4
- room_count: 1
- sources: all
- example: @네오 @네오 @배불뚝 제이지 @힙합맨 제이지 @힙합맨 제이지 @멍한 프렌즈 @멍한 프렌즈 @인사하는 프렌즈 @인사하는 프렌즈 @인사하는 프렌즈 기본닉네임이신분들~~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다! 미변경시 정리됩니다 ㅠ.ㅠ
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 333. 네오 일 네오 건방진 제이지 치맥하는 제이지 자랑하는 라이언 티비 보는 라이언 하트를 든 라이언 하트를 든 라이언 춤추는 니니즈 단호한 프로도 퇴근하는 프로도 프로도 디지털노마드 하이클래스
- count: 4
- room_count: 1
- sources: all
- example: @네오 @일 네오 @건방진 제이지 @치맥하는 제이지 @자랑하는 라이언 @티비 보는 라이언 @하트를 든 라이언 @하트를 든 라이언 @춤추는 니니즈 @단호한 프로도 @퇴근하는 프로도 @프로도(디지털노마드 하이클래스) 
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 334. 넵 오류인가 아닌가 왜 안뜨는거지
- count: 4
- room_count: 1
- sources: all
- example: 넵.. 오류인가 아닌가 왜 안뜨는거지 !!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 335. 넹넹 입금샷이랑 해서 채널톡에 넣어야 하는거 같길래 넣긴 했어요
- count: 4
- room_count: 1
- sources: all
- example: 넹넹 입금샷이랑 해서 채널톡에 넣어야 하는거 같길래 넣긴 했어요
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 336. 노래하는 춘식이 기뻐하는 라이언 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @노래하는 춘식이 @기뻐하는 라이언 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 337. 노래하는 춘식이 억울한 춘식이 인사하는 춘식이 축하하는 춘식이 축하하는 춘식이 기본닉네임이신분들 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다 미변경시 정리됩니다
- count: 4
- room_count: 1
- sources: all
- example: @노래하는 춘식이 @억울한 춘식이 @인사하는 춘식이 @축하하는 춘식이 @축하하는 춘식이 기본닉네임이신분들~~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다! 미변경시 정리됩니다 ㅠ.ㅠ
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 338. 노런 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @노런 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 339. 누구요
- count: 4
- room_count: 1
- sources: all
- example: 누구요?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 340. 누워있는 죠르디 어서오세요 닉네임변경이랑 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @누워있는 죠르디 어서오세요~ 닉네임변경이랑 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 341. 니나노 분석은요
- count: 4
- room_count: 1
- sources: all
- example: 니나노 분석은요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 342. 닉네임 변경 부탁드려용
- count: 4
- room_count: 1
- sources: all
- example: 닉네임 변경 부탁드려용~~
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 343. 다 당근
- count: 4
- room_count: 1
- sources: all
- example: 다...당근?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 344. 다 정해주는 강의가 있나요
- count: 4
- room_count: 1
- sources: all
- example: 다 정해주는 강의가 있나요??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 345. 다들 편집 프로그램은 어떤거 쓰시나요 쇼츠
- count: 4
- room_count: 1
- sources: all
- example: 다들 편집 프로그램은 어떤거 쓰시나요? (쇼츠)
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 346. 다른영상에 대본 따와서 재창작하는데 그장면도 제작과정으로보고 영상촬영에 넣어야하죠
- count: 4
- room_count: 1
- sources: all
- example: 다른영상에 대본 따와서 재창작하는데 그장면도 제작과정으로보고 영상촬영에 넣어야하죠?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 347. 다링님이요
- count: 4
- room_count: 1
- sources: all
- example: 다링님이요!?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 348. 다시보기 신청하세요 n만원 또는 n만원정도합니다
- count: 4
- room_count: 1
- sources: all
- example: 다시보기 신청하세요 3만원 또는 5만원정도합니다
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 349. 다크팬더 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @다크팬더 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 350. 달빛자르기n 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @달빛자르기2 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 351. 담에 만나면 스님 복장으로 오는거 아님
- count: 4
- room_count: 1
- sources: all
- example: 담에 만나면 스님 복장으로 오는거 아님?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 352. 당근
- count: 4
- room_count: 1
- sources: all
- example: 당근?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 353. 당근에도 많이 올라오던데용
- count: 4
- room_count: 1
- sources: all
- example: 당근에도 많이 올라오던데용?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 354. 당근오리 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @당근오리 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 355. 대출 을마
- count: 4
- room_count: 1
- sources: all
- example: 대출 을마..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 356. 더 간단하게 잘 알려주시는 분들도많으니 한번 서치해보시는걸 추천드립니다
- count: 4
- room_count: 1
- sources: all
- example: 더 간단하게 잘 알려주시는 분들도많으니 한번 서치해보시는걸 추천드립니다ㅎㅎ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 357. 도도 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @도도 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 358. 도도 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @도도 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 359. 도롱뇽 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @도롱뇽 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 360. 도착하면알려듀삼
- count: 4
- room_count: 1
- sources: all
- example: 도착하면알려듀삼
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 361. 돈 뿌리는 라이언 어서오세요 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @돈 뿌리는 라이언 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 362. 동시에 댓글이 달리면서 대댓글이 따딱 자동으로 달리면
- count: 4
- room_count: 1
- sources: all
- example: 동시에? 댓글이 달리면서 대댓글이 따딱 자동으로 달리면 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 363. 된 건가요
- count: 4
- room_count: 1
- sources: all
- example: 된 건가요??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 364. 두두 roy 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @ㅊㅇㅅ @두두 @Roy 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 365. 두부 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @두부 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 366. 둘이서 맥주 한잔 할래
- count: 4
- room_count: 1
- sources: all
- example: 둘이서 맥주 한잔 할래?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 367. 둘이서 헤경이는 뺴고
- count: 4
- room_count: 1
- sources: all
- example: 둘이서 ? 헤경이는 뺴고 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 368. 등산객 디하클 카페매니저 님 어서오세요 소통하기 편한 닉네임 변경과 하트 스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @등산객(디하클 카페매니저) 님 어서오세요~ 소통하기 편한 닉네임 변경과 하트 스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 369. 디너캔슬링하시면되요
- count: 4
- room_count: 1
- sources: all
- example: 디너캔슬링하시면되요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 370. 딩글 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @딩글 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 371. 레다예 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @레다예 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 372. 레오 n님 다시보기 신청합니다
- count: 4
- room_count: 1
- sources: all
- example: 레오 96님 다시보기 신청합니다 
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 373. 레오n님 쇼츠포뮬러 무료강의 후기 n황이 되신 이유를 알게되는 강의에 많이 고맙습니다 진정으로 수강생을 위하는 마음을 느낄수있는 선한 도움에 머리숙여 감사드립니다 물고기를 주는게 아니라 물고기를 잡는 법을 알려주시는 예수님처럼 느껴지네요 제가 많이 부족하고 미흡한 사람인데 새로 의욕이 느껴집니다
- count: 4
- room_count: 1
- sources: all
- example: 레오96님 쇼츠포뮬러 무료강의 후기:  1황이 되신 이유를 알게되는 강의에 많이 고맙습니다.  진정으로 수강생을 위하는 마음을 느낄수있는 선한 도움에 머리숙여 감사드립니다.  물고기를 주는게 아니라 물고기를 잡는 법을 알려주시는 예수님처럼 느껴지네요.  제가 많이 부족하고 미흡한 사람인데.. 새로 의욕이 느껴집니다.
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 374. 레오n님의 쇼츠포뮤러 정규강의는 오늘까지 신청받나요
- count: 4
- room_count: 1
- sources: all
- example: 레오96님의 쇼츠포뮤러 정규강의는 오늘까지 신청받나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 375. 레오님강의 재시청 입금했는데 입장코드 부탁합니다
- count: 4
- room_count: 1
- sources: all
- example: 레오님강의 재시청 입금했는데, 입장코드 부탁합니다.
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 376. 로꾸꺼 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @로꾸꺼 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 377. 로드맨 님 어서오세요 소통하기 편한 닉네임 변경과 하트 스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @로드맨 님 어서오세요~ 소통하기 편한 닉네임 변경과 하트 스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 378. 로디맘 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @로디맘 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 379. 록아 오늘 야근하나
- count: 4
- room_count: 1
- sources: all
- example: 록아 오늘 야근하나?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 380. 링그 못 받았는데 확인한번 부탁 드려요
- count: 4
- room_count: 1
- sources: all
- example: 링그 못 받았는데 확인한번 부탁 드려요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 381. 링밥님 무강만 보고도 일단 인서타 시작 할 수 있나용
- count: 4
- room_count: 1
- sources: all
- example: 링밥님 무강만 보고도 일단 인서타 시작 할 수 있나용??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 382. 링밥님 무강보면 열심히만하면 수창가능티비 할까요
- count: 4
- room_count: 1
- sources: all
- example: 링밥님 무강보면 열심히만하면 수창가능티비 할까요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 383. 링밥님 오수몇
- count: 4
- room_count: 1
- sources: all
- example: 링밥님 오수몇?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 384. 링밥님 올해 안에 n기 하시나요
- count: 4
- room_count: 1
- sources: all
- example: 링밥님 올해 안에 2기 하시나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 385. 링밥님 인스타 쇼핑을 직촬 아니고 짜집기로도 조회수 및 매출이 가능하나여 부업이라 직촬은 힘든데
- count: 4
- room_count: 1
- sources: all
- example: 링밥님, 인스타 쇼핑을 직촬 아니고 짜집기로도 조회수 및 매출이 가능하나여... 부업이라 직촬은 힘든데
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 386. 링밥님 혹시 영상 고르는데 시간 어느정도 사용하시나요
- count: 4
- room_count: 1
- sources: all
- example: 링밥님 혹시 영상 고르는데 시간 어느정도 사용하시나요?!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 387. 링밥님보고 일단 내가 할지 안할지 모르겠지만 인스타 계정하나에 쿠키 쌓는중인데
- count: 4
- room_count: 1
- sources: all
- example: 링밥님보고.. 일단 내가 할지 안할지 모르겠지만.. 인스타 계정하나에 쿠키 쌓는중인데 ..ㅎㅎ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 388. 링밥님은 영상 하루에 몇개치시는건가요 n이라니
- count: 4
- room_count: 1
- sources: all
- example: 링밥님은 영상 하루에 몇개치시는건가요?ㄷㄷ 2200이라니
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 389. 링밥님이 아마 n기성과가 맘에 들어야 n기를 하실거같
- count: 4
- room_count: 1
- sources: all
- example: 링밥님이 아마 1기성과가 맘에 들어야 2기를 하실거같?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 390. 만마니 버거 부럽디
- count: 4
- room_count: 1
- sources: all
- example: 만마니 버거 부럽디 ??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 391. 멋썸 오누 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @멋썸 @오누 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 392. 멍멍구 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @멍멍구 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 393. 멍한 프렌즈 멍한 프렌즈 반가워하는 프렌즈 반가워하는 프렌즈 반가워하는 프렌즈 인사하는 프렌즈 인사하는 프렌즈 인사하는 프렌즈 기본닉네임이신분들 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다 미변경시 정리됩니다
- count: 4
- room_count: 1
- sources: all
- example: @멍한 프렌즈 @멍한 프렌즈 @반가워하는 프렌즈 @반가워하는 프렌즈 @반가워하는 프렌즈 @인사하는 프렌즈 @인사하는 프렌즈 @인사하는 프렌즈 기본닉네임이신분들~~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다! 미변경시 정리됩니다 ㅠ.ㅠ
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 394. 몇시 시작인가요
- count: 4
- room_count: 1
- sources: all
- example: 몇시 시작인가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 395. 몸살약먹어서 자야되는데 여기를 못벗어나네요
- count: 4
- room_count: 1
- sources: all
- example: 몸살약먹어서 자야되는데 여기를 못벗어나네요..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 396. 몸살약묵어서 그좋은 특강을 끝까지못보고 n시에 자부렀
- count: 4
- room_count: 1
- sources: all
- example: 몸살약묵어서 그좋은 특강을 끝까지못보고 12시에 자부렀..ㅜㅜ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 397. 못하냐 이말입니다
- count: 4
- room_count: 1
- sources: all
- example: 못하냐 이말입니다
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 398. 몽땅주스
- count: 4
- room_count: 1
- sources: all
- example: 몽땅주스?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 399. 무강 재구매율 최강 기록 아니실까요
- count: 4
- room_count: 1
- sources: all
- example: 무강 재구매율 최강 기록 아니실까요? ㅎㅎㅎ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 400. 무강만으로도 완전 가능이고
- count: 4
- room_count: 1
- sources: all
- example: 무강만으로도 완전 가능이고
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 401. 무강은 모에요
- count: 4
- room_count: 1
- sources: all
- example: 무강은 모에요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 402. 무료강의 어떻게 보나요
- count: 4
- room_count: 1
- sources: all
- example: 무료강의 어떻게 보나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 403. 무료강의 초대링크좀요
- count: 4
- room_count: 1
- sources: all
- example: 무료강의 초대링크좀요
- decision.intent: free_apply_recent_3
- decision.reason: KB_MENU_23_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 신청/공지 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 404. 무료강의 후기 여기서 올리나요
- count: 4
- room_count: 1
- sources: all
- example: 무료강의 후기 여기서 올리나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 405. 무료강의가 있나요
- count: 4
- room_count: 1
- sources: all
- example: 무료강의가 있나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 406. 무료강의는 끝났나요
- count: 4
- room_count: 1
- sources: all
- example: 무료강의는 끝났나요...?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 407. 무료특강신청하신건가요 하늘아래님
- count: 4
- room_count: 1
- sources: all
- example: 무료특강신청하신건가요? 하늘아래님
- decision.intent: free_apply_recent_3
- decision.reason: KB_MENU_23_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 신청/공지 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 408. 무원n 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @무원60 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 409. 미진 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @미진 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 410. 바로 결제했는데는 소감이 아니지 않나요
- count: 4
- room_count: 1
- sources: all
- example: 바로 결제했는데는 소감이 아니지 않나요 ㅋㅋㅋ
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 411. 박 새시작을 호푼드 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @박 @새시작을 @호푼드 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 412. 박스에 들어간 춘식이 박스에 들어간 춘식이 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @박스에 들어간 춘식이 @박스에 들어간 춘식이 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 413. 박스에 들어간 춘식이 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @박스에 들어간 춘식이 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 414. 박진감넘쳐 님 어서오세요 소통하기 편한 닉네임 변경과 하트 스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @박진감넘쳐 님 어서오세요~ 소통하기 편한 닉네임 변경과 하트 스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 415. 반가워하는 니니즈 반가워하는 프렌즈 반가워하는 프렌즈 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @반가워하는 니니즈 @반가워하는 프렌즈 @반가워하는 프렌즈 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 416. 반가워하는 프렌즈 반가워하는 프렌즈 반가워하는 프렌즈 반가워하는 프렌즈 apeach giving a kiss 한숨 쉬는 죠르디 어서오세요 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @반가워하는 프렌즈 @반가워하는 프렌즈 @반가워하는 프렌즈 @반가워하는 프렌즈 @Apeach Giving A Kiss @한숨 쉬는 죠르디 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 417. 반갑습니다 소통하기 쉬운 닉네임으로 변경해주시면 감사하겠습니다
- count: 4
- room_count: 1
- sources: all
- example: 반갑습니다!! 소통하기 쉬운 닉네임으로 변경해주시면 감사하겠습니다🥰
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 418. 반달맘n 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @반달맘9188 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 419. 방송 주소 나왔나요
- count: 4
- room_count: 1
- sources: all
- example: 방송 주소 나왔나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 420. 배부른 춘식이 배부른 춘식이 배부른 춘식이 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @배부른 춘식이 @배부른 춘식이 @배부른 춘식이 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 421. 변경과하트했습니다
- count: 4
- room_count: 1
- sources: all
- example: 변경과하트했습니다
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 422. 보고 싶었는데 못봤어요
- count: 4
- room_count: 1
- sources: all
- example: 보고 싶었는데...못봤어요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 423. 본질은 옆에서 알려드릴 수 있거든요
- count: 4
- room_count: 1
- sources: all
- example: 본질은 옆에서 알려드릴 수 있거든요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 424. 볼 찌르는 라이언 어서오세요 닉네임변경이랑 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @볼 찌르는 라이언 어서오세요~ 닉네임변경이랑 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 425. 부끄러운 어피치 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @부끄러운 어피치 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 426. 부럽디
- count: 4
- room_count: 1
- sources: all
- example: 부럽디 ??
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 427. 부산 esse 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @부산 ESSE 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 428. 부업이신가요 시지지님
- count: 4
- room_count: 1
- sources: all
- example: 부업이신가요 시지지님..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 429. 불 뿜는 튜브 청소하는 튜브 호호 부는 튜브 화난 튜브 기본닉네임이신분들 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다 미변경시 정리됩니다
- count: 4
- room_count: 1
- sources: all
- example: @불 뿜는 튜브 @청소하는 튜브 @호호 부는 튜브 @화난 튜브 기본닉네임이신분들~~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다! 미변경시 정리됩니다 ㅠ.ㅠ
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 430. 브루 음원 삽입하는거야뭐 괜찮지 않을까요
- count: 4
- room_count: 1
- sources: all
- example: 브루 음원 삽입하는거야뭐 괜찮지 않을까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 431. 브이로그 말씀하시는 거죠
- count: 4
- room_count: 1
- sources: all
- example: 브이로그 말씀하시는 거죠?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 432. 비번이 뭐에요
- count: 4
- room_count: 1
- sources: all
- example: 비번이 뭐에요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 433. 비전 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @비전 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 434. 빌선 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @빌선 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 435. 뽀뽀하는 어피치 뽀뽀하는 어피치 뽀뽀하는 어피치 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @뽀뽀하는 어피치 @뽀뽀하는 어피치 @뽀뽀하는 어피치 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!  
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 436. 뽀뽀하는 어피치 뽀뽀하는 어피치 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @뽀뽀하는 어피치 @뽀뽀하는 어피치 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 437. 뿌리 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @뿌리 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 438. 사랑에 빠진 죠르디 사랑에 빠진 죠르디 어서오세요 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @사랑에 빠진 죠르디 @사랑에 빠진 죠르디 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 439. 사랑에 빠진 죠르디 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @사랑에 빠진 죠르디 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 440. 사알못 사주 자동화 후기 후기를 안적을수 없는 강의
- count: 4
- room_count: 1
- sources: all
- example: 사알못 사주 자동화 후기 :후기를 안적을수 없는 강의
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 441. 사운드카드로 조절안됨
- count: 4
- room_count: 1
- sources: all
- example: 사운드카드로 조절안됨?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 442. 살은 왜 안빠지누
- count: 4
- room_count: 1
- sources: all
- example: 살은 왜 안빠지누
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 443. 삼수했냐
- count: 4
- room_count: 1
- sources: all
- example: 삼수했냐?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 444. 삼일 굶은 사람마냥 배가 너어어무 고파
- count: 4
- room_count: 1
- sources: all
- example: 삼일 굶은 사람마냥 배가 너어어무 고파 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 445. 상담하는 죠르디 상담하는 죠르디 상담하는 죠르디 일하는 죠르디 집 지키는 죠르디 집 지키는 죠르디 하품하는 죠르디 어서오세요 닉네임변경이랑 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @상담하는 죠르디 @상담하는 죠르디 @상담하는 죠르디 @일하는 죠르디 @집 지키는 죠르디 @집 지키는 죠르디 @하품하는 죠르디 어서오세요~ 닉네임변경이랑 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 446. 상담하는 죠르디 상담하는 죠르디 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @상담하는 죠르디 @상담하는 죠르디 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 447. 상담하는 죠르디 어서오세요 닉네임변경 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @상담하는 죠르디 어서오세요~닉네임변경, 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 448. 생각보다 많이들 결제하시더라고요
- count: 4
- room_count: 1
- sources: all
- example: 생각보다 많이들 결제하시더라고요
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 449. 생각이 떠오른 스카피 님 어서오세요 소통하시기 편한 닉네임 변경과 하트 스크린샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: 생각이 떠오른 스카피 님 어서오세요 ~ 소통하시기 편한 닉네임 변경과 하트 스크린샷 부탁드립니다 !
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 450. 생각이 많은 스카피 손 흔드는 스카피 손 흔드는 스카피 인사하는 스카피 기본닉네임이신분들 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다 미변경시 정리됩니다
- count: 4
- room_count: 1
- sources: all
- example: @생각이 많은 스카피 @손 흔드는 스카피 @손 흔드는 스카피 @인사하는 스카피 기본닉네임이신분들~~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다! 미변경시 정리됩니다 ㅠ.ㅠ
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 451. 생각이 많은 스카피 어서오세요 닉네임변경 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @생각이 많은 스카피 어서오세요~닉네임변경, 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 452. 서강인 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @서강인 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 453. 설화 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @설화 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 454. 셀프로끝 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @셀프로끝 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 455. 소심한 네오 어서오세요 닉네임변경 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @소심한 네오 어서오세요~닉네임변경, 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 456. 소통이 편한 닉네임으로 닉네임 변경해주시지 않으시면
- count: 4
- room_count: 1
- sources: all
- example: 소통이 편한 닉네임으로, 닉네임 변경해주시지 않으시면
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 457. 손용선 cosy 어서오세요 하트스샷 부탁드립니닷
- count: 4
- room_count: 1
- sources: all
- example: @손용선 @cosy 어서오세요~ 하트스샷 부탁드립니닷
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 458. 송경민 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @송경민 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 459. 쇼츠 수익이 절반된거 아니에요
- count: 4
- room_count: 1
- sources: all
- example: 쇼츠 수익이 절반된거 아니에요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 460. 쇼츠는 자신의 롱폼을 예고편 처럼 눈에 뜨게 하기위한거라고 알고있슴돠
- count: 4
- room_count: 1
- sources: all
- example: 쇼츠는 자신의 롱폼을 예고편 처럼 눈에 뜨게? 하기위한거라고 알고있슴돠
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 461. 수익
- count: 4
- room_count: 1
- sources: all
- example: 수익?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 462. 쉬고있는 프렌즈 어서오세요 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @쉬고있는 프렌즈 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 463. 쉬고있는 프렌즈 어서오세요 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @쉬고있는 프렌즈 어서오세요~ 소통하기 편한 닉네임 변경과 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 464. 스위치온 다이어트는 머예여
- count: 4
- room_count: 1
- sources: all
- example: 스위치온 다이어트는 머예여? ㅋㅋㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 465. 스토리 채널은 어딘가요
- count: 4
- room_count: 1
- sources: all
- example: 스토리 채널은  어딘가요? 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 466. 스피이크 어서오세요 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @스피이크 어서오세요~ 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 467. 슬픈 어피치 파티하는 어피치 파티하는 어피치 티비 보는 라이언 어서오세요 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다
- count: 4
- room_count: 1
- sources: all
- example: @슬픈 어피치 @파티하는 어피치 @파티하는 어피치 @티비 보는 라이언 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!
- decision.intent: ignore
- decision.reason: WELCOME_OR_NICKNAME_FLOW

## 468. 시간안에 들어왔는데 왜 이렇죠
- count: 4
- room_count: 1
- sources: all
- example: 시간안에 들어왔는데 왜 이렇죠
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 469. 시크릿방은 랜덤인건가요
- count: 4
- room_count: 1
- sources: all
- example: 시크릿방은 랜덤인건가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 470. 신청 이곳에서 하나요
- count: 4
- room_count: 1
- sources: all
- example: 신청 이곳에서 하나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 471. 실버사연영상을 만든후 쇼츠로 홍보하는게 순서인가요
- count: 4
- room_count: 1
- sources: all
- example: 실버사연영상을 만든후 쇼츠로 홍보하는게 순서인가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 472. 실화
- count: 4
- room_count: 1
- sources: all
- example: 실화?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 473. 실화인가요
- count: 4
- room_count: 1
- sources: all
- example: 실화인가요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 474. 아 그래요
- count: 4
- room_count: 1
- sources: all
- example: 아 그래요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 475. 아 그럼 n번계정이 채널삭제먹은 계정이어도 문제는 없을까요
- count: 4
- room_count: 1
- sources: all
- example: 아 그럼 1번계정이 채널삭제먹은 계정이어도 문제는 없을까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 476. 아 무슨뜻인지 잘 모르겠어요
- count: 4
- room_count: 1
- sources: all
- example: 아. 무슨뜻인지 잘 모르겠어요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 477. 아 사업자는 없으신가요
- count: 4
- room_count: 1
- sources: all
- example: 아 사업자는 없으신가요?ㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 478. 아 아쉽내요 링크 타고 노트북으로 접속 해도 회의 암호 입력 하라고 나오네요
- count: 4
- room_count: 1
- sources: all
- example: 아 아쉽내요. 링크 타고 노트북으로 접속 해도 회의 암호 입력 하라고 ￼나오네요. 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 479. 아 저게 매출인거에요 n천은
- count: 4
- room_count: 1
- sources: all
- example: 아 저게 매출인거에요? 3천은?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 480. 아 책을 참고했다고 이야기를 하는건가용
- count: 4
- room_count: 1
- sources: all
- example: 아. .책을 참고했다고 이야기를 하는건가용?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 481. 아 챗방에서 답댓글 얘기하시는
- count: 4
- room_count: 1
- sources: all
- example: 아 챗방에서 답댓글 얘기하시는?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 482. 아 카드변경으로 재 구독 예정입니다 감사합니다
- count: 4
- room_count: 1
- sources: all
- example: 아 카드변경으로 재 구독 예정입니다! 감사합니다
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 483. 아니 가서 뭐했음
- count: 4
- room_count: 1
- sources: all
- example: ㅋㅋㅋㅋㅋㅋ아니 가서 뭐했음??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 484. 아니 오늘은 못드감 외박이라
- count: 4
- room_count: 1
- sources: all
- example: ㅋㅋㅋㅋㅋㅋㅋㅋ아니 오늘은 못드감 외박이라
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 485. 아니근데 나나리 왜 안나오는디
- count: 4
- room_count: 1
- sources: all
- example: 아니근데 나나리 왜 안나오는디..?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 486. 아니면 문제된 채널만 정지되는건가요
- count: 4
- room_count: 1
- sources: all
- example: 아니면  문제된 채널만 정지되는건가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 487. 아마 수창된 뒤 올린영상부터 들어올걸요
- count: 4
- room_count: 1
- sources: all
- example: 아마..수창된 뒤 올린영상부터 들어올걸요??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 488. 아모르 선생님 나오세요
- count: 4
- room_count: 1
- sources: all
- example: @아모르 선생님~나오세요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 489. 아모르님 얼공
- count: 4
- room_count: 1
- sources: all
- example: 아모르님 얼공?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 490. 아모르님 여기 맨날 계심
- count: 4
- room_count: 1
- sources: all
- example: 아모르님 여기 맨날 계심
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 491. 아모르님 이번 컨셉은 가을남자인겁니까
- count: 4
- room_count: 1
- sources: all
- example: 아모르님 이번 컨셉은 가을남자인겁니까?ㅋㅋㅋㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 492. 아모르님은 제가 미리 먼저 말슴 드리긴 했읍니당
- count: 4
- room_count: 1
- sources: all
- example: 아모르님은 제가 미리 먼저 말슴 드리긴 했읍니당
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 493. 아웃풋이 있으면 인풋도 있어서
- count: 4
- room_count: 1
- sources: all
- example: 아웃풋이 있으면 인풋도 있어서....?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 494. 아이폰 쓰시는분들 캡컷 앱에 블프할인 뜨나요 전 팝업이 안뜨네욤
- count: 4
- room_count: 1
- sources: all
- example: 아이폰 쓰시는분들 캡컷 앱에 블프할인 뜨나요ㅠㅠ? 전 팝업이 안뜨네욤..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 495. 아직돈은못벌지만
- count: 4
- room_count: 1
- sources: all
- example: 아직돈은못벌지만..ㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 496. 안그래도 요새 n n시간밖에 못
- count: 4
- room_count: 1
- sources: all
- example: 안그래도 요새 2~3시간밖에 못ㅈ...
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 497. 안녕하세요
- count: 4
- room_count: 1
- sources: all
- example: 안녕하세요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 498. 안녕하세요 구글계정 여러개 만들때 복구 이메일을 하나로 통일하는게 좋은가요 아니면 이거마저도 각자 분리하나요 아예 작성안하나요
- count: 4
- room_count: 1
- sources: all
- example: 안녕하세요 . 구글계정 여러개 만들때 복구 이메일을 하나로 통일하는게 좋은가요? 아니면 이거마저도 각자 분리하나요? 아예 작성안하나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 499. 안녕하세요 둘리 매니저님 디하클 채널 통해서 다시보기 신청하였습니다 시간 되실때 확인 부탁 드립니다
- count: 4
- room_count: 1
- sources: all
- example: 안녕하세요 둘리 매니저님, 디하클 채널 통해서 다시보기 신청하였습니다. 시간 되실때 확인 부탁 드립니다.
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 500. 안녕하세요 어제 튜브레터 메일로받는걸 다음날새벽n시로 지정해놓았는데 오늘 메일이 안왔는데 하루더 기다려봐야되는건가요
- count: 4
- room_count: 1
- sources: all
- example: 안녕하세요 어제 튜브레터 메일로받는걸 다음날새벽4시로 지정해놓았는데 오늘 메일이 안왔는데 하루더 기다려봐야되는건가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 501. 안녕하세요 지금 레오님 무료강의 듣고 있는데 톡방링크가 어떻게 되나요
- count: 4
- room_count: 1
- sources: ops
- example: 안녕하세요 지금 레오님 무료강의 듣고 있는데 톡방링크가 어떻게 되나요?
- decision.intent: free_apply_recent_3
- decision.reason: KB_MENU_23_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 신청/공지 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 502. 안돼 먹을거야
- count: 4
- room_count: 1
- sources: ops
- example: 안돼 먹을거야
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 503. 안되나
- count: 4
- room_count: 1
- sources: ops
- example: 안되나?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 504. 약간 해야할 일들을 알려주기보단 하면 안되는것들을 알려주는 느낌
- count: 4
- room_count: 1
- sources: ops
- example: 약간 해야할 일들을 알려주기보단 하면 안되는것들을 알려주는 느낌.
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 505. 어디 하루 n씩 버는분한테 훈수를
- count: 4
- room_count: 1
- sources: ops
- example: 어디 하루 300씩 버는분한테 훈수를 ㅋㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 506. 어디로 들어가나요
- count: 4
- room_count: 1
- sources: ops
- example: 어디로 들어가나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 507. 어디서 들을수 있나요 멤버싑 강의인가요
- count: 4
- room_count: 1
- sources: ops
- example: 어디서 들을수 있나요? 멤버싑 강의인가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 508. 어디서 받나요
- count: 4
- room_count: 1
- sources: ops
- example: 어디서 받나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 509. 어디서 보는디요
- count: 4
- room_count: 1
- sources: ops
- example: 어디서 보는디요 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 510. 어디에서나 다 있는 제품들이면
- count: 4
- room_count: 1
- sources: ops
- example: 어디에서나 다 있는 제품들이면..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 511. 어제 강의 다시보기는 안되나요
- count: 4
- room_count: 1
- sources: ops
- example: 어제 강의 다시보기는 안되나요?
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 512. 언제 보내주셨나요
- count: 4
- room_count: 1
- sources: ops
- example: 언제 보내주셨나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 513. 언제까지
- count: 4
- room_count: 1
- sources: ops
- example: 언제까지
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 514. 여러분들 식사 날짜 언제쯤 하는게 갠춘하겠심꺼
- count: 4
- room_count: 1
- sources: ops
- example: 여러분들 식사 날짜 언제쯤 하는게 갠춘하겠심꺼
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 515. 오늘 강의 혹시 언제 시작하나요
- count: 4
- room_count: 1
- sources: ops
- example: 오늘 강의 혹시 언제 시작하나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 516. 오늘 쇼츠포뮬러 n시 강의는 언제 공지주시나요
- count: 4
- room_count: 1
- sources: ops
- example: 오늘 쇼츠포뮬러 7시 강의는 언제 공지주시나요? 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 517. 오늘 저녁 무료특강 신청 원하는데 방법 좀 알려주세요
- count: 4
- room_count: 1
- sources: ops
- example: 오늘 저녁 무료특강 신청 원하는데 방법 좀 알려주세요^^
- decision.intent: free_apply_recent_3
- decision.reason: KB_MENU_23_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 신청/공지 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 518. 와 언제 사람이 이렇게 많아졌죠
- count: 4
- room_count: 1
- sources: ops
- example: 와 언제 사람이 이렇게 많아졌죠 ㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 519. 요 며칠 n n만 정도 쇼츠 조회수가 나오다가 방금 올렸더니 n분째 조회수가 n이네요 이런적이 없는데 이럴땐 삭제하고 내일 다시 올려야할까요 그냥 기다려야할까요
- count: 4
- room_count: 1
- sources: ops
- example: 요 며칠 1~3만 정도 쇼츠 조회수가 나오다가 방금 올렸더니 30분째 조회수가 2이네요.. 이런적이 없는데… 이럴땐 삭제하고 내일 다시 올려야할까요 그냥 기다려야할까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 520. 유량님 신규채널에 롱폼 n개 율렸다가 이틀동안 피드가 n이라서 삭제했는데 다른 영상 올려도 지장 없는 상황일까요
- count: 4
- room_count: 1
- sources: ops
- example: 유량님 신규채널에 롱폼 1개 율렸다가 이틀동안 피드가 0이라서 삭제했는데 다른 영상 올려도 지장 없는 상황일까요? 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 521. 유료강의 문의 드렸는데 답변은 언제 받을수 있을까요 언제까지 결제 진행을 해야하는건지요
- count: 4
- room_count: 1
- sources: ops
- example: 유료강의 문의 드렸는데 답변은 언제 받을수 있을까요? 언제까지 결제 진행을 해야하는건지요?
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 522. 유튜브 api 키 발급 시 사용 버튼을 눌러서 권한을 부여에서 앱 제한 에서 http referrer 웹사이트 url 나 ip 주소를 지정 하는 것이 안되어서 권한부역 안되어있네 앱 제한 에서 http referrer 웹사이트 url 가 뭐야
- count: 4
- room_count: 1
- sources: ops
- example: ? 유튜브 API 키 발급 시 '사용' 버튼을 눌러서 권한을 부여에서 앱 제한”에서 HTTP referrer(웹사이트 URL)나 IP 주소를 지정 하는 것이 안되어서 권한부역 안되어있네... 앱 제한”에서 HTTP referrer(웹사이트 URL)가 뭐야?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 523. 유튭은 왜 업데이트 안되나요
- count: 4
- room_count: 1
- sources: ops
- example: 유튭은 왜 업데이트 안되나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 524. 으로 두계정 세팅하시면 안되나여
- count: 4
- room_count: 1
- sources: ops
- example: 으로 두계정 세팅하시면 안되나여
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 525. 이거 한도상향 안되면 어쩌즤
- count: 4
- room_count: 1
- sources: ops
- example: 이거 한도상향 안되면 어쩌즤
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 526. 이방이 전체 오픈 된 지가 얼마 안되어서
- count: 4
- room_count: 1
- sources: ops
- example: 이방이 전체 오픈 된 지가 얼마 안되어서
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 527. 이분 안되겟네
- count: 4
- room_count: 1
- sources: ops
- example: 이분 안되겟네!!!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 528. 인스타그램에 업로드 된 영상도 다운로드 가능한가요
- count: 4
- room_count: 1
- sources: ops
- example: ? 인스타그램에 업로드 된 영상도 다운로드 가능한가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 529. 인증키를 입력하라고 나와서 방법 문의드립니다
- count: 4
- room_count: 1
- sources: ops
- example: 인증키를 입력하라고 나와서 방법 문의드립니다   / 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 530. 인포크링크 사용법 알려줘
- count: 4
- room_count: 1
- sources: ops
- example: ? 인포크링크 사용법 알려줘
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 531. 일타강사같으셔서 롱폼 강의 들은지 얼마 안되서 지금은 힘들지만 n기는 꼭 수강해보겠습니다
- count: 4
- room_count: 1
- sources: ops
- example: 일타강사같으셔서 ㅎㅎ 롱폼 강의 들은지 얼마 안되서 지금은 힘들지만 2기는 꼭 수강해보겠습니다!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 532. 잠깐 졸고 있었나봐요 오늘 pdf랑 자료 어디서 받지요
- count: 4
- room_count: 1
- sources: ops
- example: 잠깐 졸고 있었나봐요. 오늘 pdf랑 자료 어디서 받지요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 533. 제가 이 방에 온지 얼마 안돼서 정보가 없네요
- count: 4
- room_count: 1
- sources: ops
- example: 제가 이 방에 온지 얼마 안돼서 정보가 없네요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 534. 주소도 나와잇는데로 띄어쓰기 똑같이하셔야해요 두가지방법 해보세요
- count: 4
- room_count: 1
- sources: ops
- example: 주소도 나와잇는데로 띄어쓰기 똑같이하셔야해요 두가지방법 해보세요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 535. 줌 비번이 어떻게 되나요
- count: 4
- room_count: 1
- sources: ops
- example: 줌 비번이 어떻게 되나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 536. 줌비번 없을걸요
- count: 4
- room_count: 1
- sources: ops
- example: 줌비번 없을걸요?!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 537. 진짜 초보질문드려요 항상 집에서만 하다가 게을러지는 것 같아서 도서관이나 카페에 가서 해보려고 하는데 그런데서 와이파이 연결은 어떻게 하시나요 공용연결로 하시는지 궁금합니당
- count: 4
- room_count: 1
- sources: ops
- example: 진짜 초보질문드려요. 항상 집에서만 하다가 게을러지는 것 같아서 도서관이나 카페에 가서 해보려고 하는데 그런데서 와이파이 연결은 어떻게 하시나요? 공용연결로 하시는지 궁금합니당..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 538. 채널 삭제 당해서 구글 id 탈퇴하고 관련 사이트 모두 탈퇴 했는데요 컴텨는 켬텨이름만 변경 하면 될까요 현재 회사 ip는 유동이라 변경 되는것 확인했구 집에 ip는 가서 변경 되는것 확인 할예정이구 또 무엇을 변경 해야 할까요
- count: 4
- room_count: 1
- sources: ops
- example: 채널 삭제 당해서 구글 id 탈퇴하고 관련 사이트 모두 탈퇴 했는데요... 컴텨는 켬텨이름만 변경 하면 될까요? 현재 회사 ip는 유동이라 변경 되는것 확인했구.. 집에 ip는 가서 변경 되는것 확인 할예정이구... 또 무엇을 변경 해야 할까요? 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 539. 초대링크 어디서받나요
- count: 4
- room_count: 1
- sources: ops
- example: 초대링크 어디서받나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 540. 카톡 프렌즈 n차 프로필 쓰는건 괜찮은데 그떄 자동으로 주어지는거 쓰지마라 n차 프로필은 쓰는데 이름은 카페에서 쓰는 닉으로 맞춰라 이런의미 맞나요
- count: 4
- room_count: 1
- sources: ops
- example: 카톡 프렌즈 2차 프로필 쓰는건 괜찮은데 그떄 자동으로 주어지는거 쓰지마라? 2차 프로필은 쓰는데 이름은 카페에서 쓰는 닉으로 맞춰라? 이런의미 맞나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 541. 카페
- count: 4
- room_count: 1
- sources: ops
- example: 카페?
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 542. 크몽이나 숨고 같은데 말고 없나요
- count: 4
- room_count: 1
- sources: ops
- example: 크몽이나 숨고 같은데 말고 없나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 543. 튜브렌즈 맥에서는 설치가 안되는건가요
- count: 4
- room_count: 1
- sources: ops
- example: 튜브렌즈 맥에서는 설치가 안되는건가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 544. 튜브렌즈 자막수집이 안되는 영상은 대본만들수 없는걸까요
- count: 4
- room_count: 1
- sources: ops
- example: 튜브렌즈 자막수집이 안되는 영상은 대본만들수 없는걸까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 545. 트래픽받았을때 그럼 영상 n개씩 올려도 되나요
- count: 4
- room_count: 1
- sources: ops
- example: 트래픽받았을때 그럼 영상 2개씩 올려도 되나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 546. 트렌드를 잘타고 조회수를 떡상시킬 수 있는방법 참고 할 수 있는 튜브렌즈 유튜브 영상 알려줘
- count: 4
- room_count: 1
- sources: ops
- example: ? 트렌드를 잘타고 조회수를 떡상시킬 수 있는방법 참고 할 수 있는 튜브렌즈 유튜브 영상 알려줘
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 547. 특강 신청하고 어디로 가면 되나요
- count: 4
- room_count: 1
- sources: ops
- example: 특강 신청하고 어디로 가면 되나요??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 548. 틱톡 사업자 등록 거부 자꾸 나는데 사유를 알려주지 않고 그냥 승인거부만 자꾸 뜨네요 그동안 비즈니스 계정에 인포링크 잘 걸어 쓰고 있었는데 체험기간이 끝나다고 재등록 하라해서 하란대로 했는데 자꾸 거부나서 링크를 못 달고 있습니다 혹시 저와 같은 문제 겪고 해결하신분 계실까요
- count: 4
- room_count: 1
- sources: ops
- example: 틱톡 사업자 등록 거부 자꾸 나는데 사유를 알려주지 않고 그냥 승인거부만 자꾸 뜨네요. 그동안 비즈니스 계정에 인포링크 잘 걸어 쓰고 있었는데 체험기간이 끝나다고 재등록 하라해서 하란대로 했는데 자꾸 거부나서 링크를 못 달고 있습니다. 혹시 저와 같은 문제 겪고 해결하신분 계실까요?
- decision.intent: cafe_join_upgrade
- decision.reason: KB_BOARD_31_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 카페 가입/등업 안내는 공지 기준으로 진행돼요.

1) 가입/등업 안내 글(최신)을 확인해 주세요.
2) 닉네임 규칙/가입인사/승인 조건이 거기 적혀 있어요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 549. 틱톡은 틱톡라이크 아니고 틱톡이죠 쇼핑링크걸고 올리는거나 그런건 동일하게하면되나용
- count: 4
- room_count: 1
- sources: ops
- example: 틱톡은 틱톡라이크 아니고 틱톡이죠?? 쇼핑링크걸고 올리는거나 그런건 동일하게하면되나용
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 550. 하 알림 킨거 채팅방 두개밖에 안되는데 카톡 카톡 그러는거 시끄럽게 들리는데 강사님들하고 스텝분들은 방 여러개 켜놓고 어떻게 하시는거야
- count: 4
- room_count: 1
- sources: ops
- example: (하.... 알림 킨거 채팅방 두개밖에 안되는데 ㅡ카톡 ㅡ 카톡ㅡ  그러는거 시끄럽게 들리는데  강사님들하고 스텝분들은 방 여러개 켜놓고 어떻게 하시는거야...)
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 551. 하트 스크린샷이 뭔가요 reaction에 하트 누른거 이야기 하는거에요
- count: 4
- room_count: 1
- sources: ops
- example: 하트 스크린샷이 뭔가요? reaction에 하트 누른거 이야기 하는거에요? 
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 552. 하트를 어떻게하는거에요
- count: 4
- room_count: 1
- sources: ops
- example: 하트를 어떻게하는거에요
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 553. 하트스샷을 어떻게 하는거죠
- count: 4
- room_count: 1
- sources: ops
- example: 하트스샷을 어떻게 하는거죠?
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 554. 하트캡쳐는 어디다 올리나요
- count: 4
- room_count: 1
- sources: ops
- example: 하트캡쳐는 어디다 올리나요
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 555. 한달에 n도 안되느돈 벌라고
- count: 4
- room_count: 1
- sources: ops
- example: 한달에 500도 안되느돈 벌라고
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 556. 혹시 다된다윤 님 보내주신 자료중 브루는 어떻게 열어서 보는걸까요
- count: 4
- room_count: 1
- sources: ops
- example: 혹시 다된다윤 님   보내주신 자료중 브루는 어떻게 열어서 보는걸까요? 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 557. 혹시 알바 쓰시는 분들 캡컷 프로그램같은건 누가 결제하는걸까요
- count: 4
- room_count: 1
- sources: ops
- example: 혹시 알바 쓰시는 분들 캡컷 프로그램같은건 누가 결제하는걸까요...?
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 558. 혹시 효과음 다운로드는 어디서 가능하다고 하셨던 것 같은데 어디였을까요 멤버십했는데 잘 안보이네요
- count: 4
- room_count: 1
- sources: ops
- example: 혹시 효과음 다운로드는 어디서 가능하다고 하셨던 것 같은데 어디였을까요? 멤버십했는데, 잘 안보이네요!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 559. 혹시 후기 언제까지 작성인가요
- count: 4
- room_count: 1
- sources: ops
- example: 혹시 후기 언제까지 작성인가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 560. 후기폼은 어디서 작성하나요
- count: 4
- room_count: 1
- sources: ops
- example: 후기폼은 어디서 작성하나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 561. 힝 여보 기다릴라구했는데 안되겟다리
- count: 4
- room_count: 1
- sources: ops
- example: 힝 ㅠ 여보 기다릴라구했는데 안되겟다리ㅠㅠㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 562. ai 사주 수익화 방법이 있다니 신기하네요 신세계였어요 많은 것을 배울 수 있어서 좋았습니다 특히 실제 응용해서 진행할 수 있는 많은 방법들을 알려주셔서 감사했습니다 체계적으로 준비하고 가르쳐주신 강사님께 다시한번 감사드려요 무료로 주신 자료로 열심히 응용해 보겠습니다 감사합니다
- count: 3
- room_count: 1
- sources: ops
- example: AI 사주 수익화 방법이 있다니 신기하네요..! 신세계였어요! 많은 것을 배울 수 있어서 좋았습니다. 특히, 실제 응용해서 진행할 수 있는 많은 방법들을 알려주셔서 감사했습니다! 체계적으로 준비하고 가르쳐주신 강사님께 다시한번 감사드려요!!! 무료로 주신 자료로 열심히 응용해 보겠습니다! 감사합니다!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 563. pdf어디서 받나요
- count: 3
- room_count: 1
- sources: ops
- example: PDF어디서 받나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 564. 다시보기 영상 n개 신청했는데 n개분만 메일로 왔는데 나머지 영상은 언제 보내주실수 있을까요 채널톡으로 문의 드렸는데 아직 연락이 없으셔서 여기에 남겨봅니다
- count: 3
- room_count: 1
- sources: ops
- example: 다시보기 영상 2개 신청했는데 1개분만 메일로 왔는데 나머지 영상은 언제 보내주실수 있을까요?? 채널톡으로 문의 드렸는데 아직 연락이 없으셔서 여기에 남겨봅니다 ㅠㅠ
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 565. 롱폼 시작하려는데 초반엔 하루에 한게씩 올려야할까요
- count: 3
- room_count: 1
- sources: ops
- example: 롱폼 시작하려는데 초반엔 하루에 한게씩 올려야할까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 566. 말 안되는뎈
- count: 3
- room_count: 1
- sources: ops
- example: 말 안되는뎈ㅋㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 567. 보너스프로그램은 언제쯤 오나요 프로모션 메일은 오는데 아침에 톡방에 남겼는데요
- count: 3
- room_count: 1
- sources: ops
- example: 보너스프로그램은 언제쯤 오나요? 프로모션 메일은  오는데.. 아침에 톡방에 남겼는데요   
- decision.intent: bonus_program_howto
- decision.reason: KB_MENU_23_FILTER_BONUS

예상 발신(Reply) 템플릿(placeholder):
```
😊 보너스 프로그램은 최신 공지 글 기준으로 진행돼요.

📌 핵심만 정리하면
- {s1}
- {s2}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 568. 수강은어디서할수있나요
- count: 3
- room_count: 1
- sources: ops
- example: 수강은어디서할수있나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 569. 안되면되게하라
- count: 3
- room_count: 1
- sources: ops
- example: 안되면되게하라
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 570. 언제
- count: 2
- room_count: 2
- sources: ops
- example: 언제 ?
- example: 언제 ㅋㅋ
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 571. 그런게 잠깐이라도나오면 안되나봐요
- count: 2
- room_count: 1
- sources: ops
- example: 그런게 잠깐이라도나오면 안되나봐요..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 572. 롱폼 영상 n개째 올리고 있는데 어디서 잡지식 주워듣고 중간에 모든 영상에다가 태그를 좀 많이 달았어요 물론 유관한 태그를 달긴했습니다만 태그가 너무 많았던 탓인지 모든 영상이 노출이 아예 안되는데
- count: 2
- room_count: 1
- sources: ops
- example: 롱폼 영상 7개째 올리고 있는데, 어디서 잡지식 주워듣고 중간에 모든 영상에다가 태그를 좀 많이 달았어요. 물론 유관한 태그를 달긴했습니다만, 태그가 너무 많았던 탓인지 모든 영상이 노출이 아예 안되는데
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 573. 비공개로 예약해놓고 잘못올려서 업로드 전에 글 삭제하고 다시 올렸는데 알고리즘에 영향이있나
- count: 2
- room_count: 1
- sources: ops
- example: ? 비공개로 예약해놓고 잘못올려서 업로드 전에 글 삭제하고 다시 올렸는데 알고리즘에 영향이있나?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 574. 아직까지도 답장이 강의 결제후 문의 채널톡에 남겼는데여
- count: 2
- room_count: 1
- sources: ops
- example: 아직까지도 답장이.. 강의 결제후 문의 채널톡에 남겼는데여ㅜㅜㅜ
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 575. 안녕하세요 저는 해외 사는데 튜브 렌즈 가입 하려고 하니까 핸드폰 번호를 입력하라고 하더라구요 그런데 현지 전화번호 입력하니 안되네요
- count: 2
- room_count: 1
- sources: ops
- example: 안녕하세요 저는 해외 사는데 튜브 렌즈 가입 하려고 하니까 핸드폰 번호를 입력하라고 하더라구요 그런데 현지 전화번호 입력하니 안되네요~ ㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 576. 안녕하세요 튜브렌즈 구매했는데요 키입력해서 사용하기 전입니다 이게 n대의 컴퓨터에서만 가능하다고 했으니 집에 노트북과 pc있더라도 둘 중 하나에서만 사용이 가능하다는 뜻이죠 답을 듣고 만일 하나를 특정해야 한다고 하면 어디에 등록할 지 고민해야해서요
- count: 2
- room_count: 1
- sources: ops
- example: 안녕하세요 튜브렌즈 구매했는데요 키입력해서 사용하기 전입니다. 이게 1대의 컴퓨터에서만 가능하다고 했으니 집에 노트북과 PC있더라도 둘 중 하나에서만 사용이 가능하다는 뜻이죠?(답을 듣고 만일 하나를 특정해야 한다고 하면 어디에 등록할 지 고민해야해서요^^)
- example: ?안녕하세요 튜브렌즈 구매했는데요 키입력해서 사용하기 전입니다. 이게 1대의 컴퓨터에서만 가능하다고 했으니 집에 노트북과 PC있더라도 둘 중 하나에서만 사용이 가능하다는 뜻이죠?(답을 듣고 만일 하나를 특정해야 한다고 하면 어디에 등록할 지 고민해야해서요^^)
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 577. 안되여 우리 톡방에도 못올렸어요 켘
- count: 2
- room_count: 1
- sources: ops
- example: 안되여 우리 톡방에도 못올렸어요….켘ㅋㅋㅋ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 578. 언제든 연락주십시오
- count: 2
- room_count: 1
- sources: ops
- example: 언제든 연락주십시오
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 579. 오전 n시 이후로 답변이 없으세요 확인 부칵드려요 결제 문의입니다
- count: 2
- room_count: 1
- sources: ops
- example: 오전 10시 이후로 답변이 없으세요 확인 부칵드려요 결제 문의입니다~
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 580. 제가 잘몰라서 여쭤보고싶은데 공지사항에 검색하라고 적혀있어서 조심스러운데요 무료강의는 신청하고 당첨되면 들을수있고 다시보기는 유료인건가요
- count: 2
- room_count: 1
- sources: ops
- example: 제가 잘몰라서 여쭤보고싶은데 공지사항에 검색하라고 적혀있어서 조심스러운데요..무료강의는 신청하고 당첨되면 들을수있고 다시보기는 유료인건가요?
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 581. 하트스샷했는데 다른게있나요
- count: 2
- room_count: 1
- sources: ops
- example: 하트스샷했는데 다른게있나요?
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 582. 혹시 캡컷은 음성의 공백 자동으로 삭제해주는 기능 없나요
- count: 2
- room_count: 1
- sources: ops
- example: 혹시 캡컷은 음성의 공백 자동으로 삭제해주는 기능 없나요? 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 583. 혹시 캡컷은 음성의 공백 자동으로 삭제해주는 기능 없나요 프리미어프로처럼
- count: 2
- room_count: 1
- sources: ops
- example: ?혹시 캡컷은 음성의 공백 자동으로 삭제해주는 기능 없나요? 프리미어프로처럼
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 584. 혹시 홈페이지에 설명이 없길래 어디 있는지 알수 있나요
- count: 2
- room_count: 1
- sources: ops
- example: 혹시 홈페이지에 설명이 없길래 어디 있는지 알수 있나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 585. 확실히 연령층이 높아서 그런지 쿠팡 유입은 잘 안되네요
- count: 2
- room_count: 1
- sources: ops
- example: 확실히 연령층이 높아서 그런지 쿠팡 유입은 잘 안되네요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 586. api 키 추가하는 쪽이 다 클릭이 안되요 클릭해도 창이 안떠요
- count: 1
- room_count: 1
- sources: ops
- example: Api 키 추가하는 쪽이 다 클릭이 안되요..ㅜㅜ 클릭해도 창이 안떠요 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 587. n달 존버 기간동안 조회수 기대 안하고 n일 n영상 올리면 되겠죠 혹시 알고리즘 꼬여있어서 노출이 안되는 거 모르고 시체놀이 하는 경우는 뭘로 알 수가 있을까요
- count: 1
- room_count: 1
- sources: ops
- example: 3달 존버 기간동안 조회수 기대 안하고 1일 1영상 올리면 되겠죠? 혹시 알고리즘 꼬여있어서 노출이 안되는 거 모르고 시체놀이 하는 경우는 뭘로 알 수가 있을까요? 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 588. 개인강습은 안되나요
- count: 1
- room_count: 1
- sources: ops
- example: 개인강습은 안되나요?ㅎ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 589. 갸악 안돼
- count: 1
- room_count: 1
- sources: ops
- example: 갸악 안돼
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 590. 걍 로또 당첨된거 보면서 아 나는 왜 안되지
- count: 1
- room_count: 1
- sources: ops
- example: 걍 로또 당첨된거 보면서 아 나는 왜 안되지?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 591. 결제완료해서 채널톡 드렸는데 언제쯤 답장주실수있는지요
- count: 1
- room_count: 1
- sources: ops
- example: 결제완료해서 채널톡 드렸는데 언제쯤 답장주실수있는지요.......
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 592. 공지방 남기고 n 나가면될까요
- count: 1
- room_count: 1
- sources: ops
- example: 공지방  남기고 3  나가면될까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 593. 공지방과 공지방n 어떤차이가있나요
- count: 1
- room_count: 1
- sources: ops
- example: 공지방과 공지방3.. 어떤차이가있나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 594. 구매전 문의드려요 노트북이 넘오래되서 바꿀예정인데 인증키사용상 대만 된다는게 동시사용 n대 등록일까요 노트북 변경후 이전노트북인증 취소후 새노트북에 변경 되나요 담달이나 그담달 바꿀꺼라서요
- count: 1
- room_count: 1
- sources: ops
- example: 구매전 문의드려요.노트북이 넘오래되서 바꿀예정인데 인증키사용상 ㅣ대만 된다는게 동시사용 1대 등록일까요? 노트북 변경후 이전노트북인증 취소후 새노트북에 변경 되나요? 담달이나 그담달 바꿀꺼라서요~
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 595. 그래서 언제시라구요
- count: 1
- room_count: 1
- sources: ops
- example: 그래서 언제시라구요?!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 596. 그럼 유튜브 계정사는사람들은 뭘어떻게 하는건지 이해가 전혀안되네요
- count: 1
- room_count: 1
- sources: ops
- example: 그럼 유튜브 계정사는사람들은 뭘어떻게 하는건지 이해가 전혀안되네요...
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 597. 그리고 일반반 결제했는데 프반으로 변경하고싶으면 어떻게 해야 하는지요
- count: 1
- room_count: 1
- sources: ops
- example: 그리고 일반반 결제했는데 프반으로 변경하고싶으면 어떻게 해야 하는지요..?
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 598. 그의 재력은 어디까지인가
- count: 1
- room_count: 1
- sources: ops
- example: 그의 재력은 어디까지인가
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 599. 근데 뷰 n n천 정도밖에 안나와서 수익화가 안되네요 어덯게해야 빵 터트리는지 아직 감을 못잡아서
- count: 1
- room_count: 1
- sources: ops
- example: 근데 뷰 1~3천 정도밖에 안나와서 수익화가 안되네요. 어덯게해야 빵 터트리는지 아직 감을 못잡아서 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 600. 근데 저런 영상 기획을 어디서 찾느냐가 관건인데
- count: 1
- room_count: 1
- sources: ops
- example: 근데 저런 영상 기획을 어디서 찾느냐가 관건인데
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 601. 끼얏 안돼
- count: 1
- room_count: 1
- sources: ops
- example: 끼얏 안돼
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 602. 내가 백날 해봣자 계정뽑기 잘못걸리면 아예 안되거든요
- count: 1
- room_count: 1
- sources: ops
- example: 내가 백날 해봣자 계정뽑기 잘못걸리면 아예 안되거든요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 603. 네 감사합니다 그러면 이 곳에서 공지가 올라오는거지용
- count: 1
- room_count: 1
- sources: ops
- example: 네 감사합니다~ 그러면 이 곳에서 공지가 올라오는거지용?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 604. 등산객 디하클 카페매니저 케로로님 보너스프로그램 url닫혔나요
- count: 1
- room_count: 1
- sources: ops
- example: @등산객(디하클 카페매니저) 케로로님 보너스프로그램 url닫혔나요?
- decision.intent: bonus_program_howto
- decision.reason: KB_MENU_23_FILTER_BONUS

예상 발신(Reply) 템플릿(placeholder):
```
😊 보너스 프로그램은 최신 공지 글 기준으로 진행돼요.

📌 핵심만 정리하면
- {s1}
- {s2}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 605. 디하클 사알못 다시보기 링크
- count: 1
- room_count: 1
- sources: ops
- example: ?디하클 사알못 다시보기 링크
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 606. 디하클스태프 둘리 혹시 시크릿방은 언제쯤 확인해주시나용
- count: 1
- room_count: 1
- sources: ops
- example: @디하클스태프 둘리 혹시 시크릿방은 언제쯤 확인해주시나용.ᐣ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 607. 링밥님 강의 언제 하세요
- count: 1
- room_count: 1
- sources: ops
- example: 링밥님 강의 언제 하세요?ㅎㅎ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 608. 링밥님 계정 처음에는 n일 n영상이라고 하셨는데 언제쯤 n일 n영상 하는게 좋은 시기일까요
- count: 1
- room_count: 1
- sources: ops
- example: 링밥님 계정 처음에는 1일 1영상이라고 하셨는데 언제쯤 1일 2영상 하는게 좋은 시기일까요??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 609. 링밥님 배타고 어디가시는거에요
- count: 1
- room_count: 1
- sources: ops
- example: 링밥님 배타고 어디가시는거에요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 610. 링크점 보내줄수있어요
- count: 1
- room_count: 1
- sources: ops
- example: 링크점 보내줄수있어요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 611. 매주 언제 강의가 있나요
- count: 1
- room_count: 1
- sources: ops
- example: 매주 언제 강의가 있나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 612. 먼가 방법을찾아야하는데
- count: 1
- room_count: 1
- sources: ops
- example: 먼가 방법을찾아야하는데
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 613. 무료강의 신청한건 언제올까용 신청한지 n n시간은 된거같아요
- count: 1
- room_count: 1
- sources: ops
- example: 무료강의 신청한건 언제올까용? 신청한지 2-3시간은 된거같아요!
- decision.intent: free_apply_recent_3
- decision.reason: KB_MENU_23_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 신청/공지 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 614. 무료강의 후기인증했는데 자료는 어디서 받을수 있나요
- count: 1
- room_count: 1
- sources: ops
- example: 무료강의 후기인증했는데 자료는 어디서 받을수 있나요?
- decision.intent: free_apply_recent_3
- decision.reason: KB_MENU_23_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 신청/공지 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 615. 보너스프로그램은 오늘안에 올까요 아침에 고객센터에 남기고 안되서 여기도 올리고 아
- count: 1
- room_count: 1
- sources: ops
- example: 보너스프로그램은 오늘안에  올까요.. 아침에 고객센터에 남기고  안되서 여기도 올리고 아..
- decision.intent: bonus_program_howto
- decision.reason: KB_MENU_23_FILTER_BONUS

예상 발신(Reply) 템플릿(placeholder):
```
😊 보너스 프로그램은 최신 공지 글 기준으로 진행돼요.

📌 핵심만 정리하면
- {s1}
- {s2}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 616. 브랜드 계정 하나 더 만들려고 하니 고급기능 이용하기가 나오는데요 그거 얼굴 인증하기로 어제 했는데 아직도 승인이 안되었는지 또 나오는데 이게 정상인가요 현재 업로드 하나도 되지 않은 본계정 n개 브랜드계정 n개 있고 하나 더 만들려고 한거거든요
- count: 1
- room_count: 1
- sources: ops
- example: 브랜드 계정 하나 더 만들려고 하니 고급기능 이용하기가 나오는데요. 그거 얼굴 인증하기로 어제 했는데 아직도 승인이 안되었는지 또 나오는데 이게 정상인가요? 현재 업로드 하나도 되지 않은 본계정 1개, 브랜드계정 1개 있고 하나 더 만들려고 한거거든요
- decision.intent: cafe_join_upgrade
- decision.reason: KB_BOARD_31_RECENT

예상 발신(Reply) 템플릿(placeholder):
```
😊 카페 가입/등업 안내는 공지 기준으로 진행돼요.

1) 가입/등업 안내 글(최신)을 확인해 주세요.
2) 닉네임 규칙/가입인사/승인 조건이 거기 적혀 있어요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 617. 비밀번호 공유하시면 안되요 카페에 후기인증글 올리신거 채널톡에 캡쳐해서 보내주시면 됩니다
- count: 1
- room_count: 1
- sources: ops
- example: 비밀번호 공유하시면 안되요~ 카페에 후기인증글 올리신거 채널톡에 캡쳐해서 보내주시면 됩니다!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 618. 사알못 다시보기 링크
- count: 1
- room_count: 1
- sources: ops
- example: ? 사알못 다시보기 링크
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 619. 사알못 다시보기 링크가 있나요 게시판만 보이는데요
- count: 1
- room_count: 1
- sources: ops
- example: 사알못 다시보기 링크가 있나요? 게시판만 보이는데요~ 
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 620. 사주가 그만큼 작은 시장이 아니기두 하고 무엇보다 바이럴 마케팅 및 광고 집행방법을 알려주시니 꼭 사주가아니라도 배워두시면 수익화 하시는데에 많은 도움이 되실거에용
- count: 1
- room_count: 1
- sources: ops
- example: 사주가 그만큼 작은 시장이 아니기두 하고 무엇보다 바이럴 마케팅 및 광고 집행방법을 알려주시니 꼭 사주가아니라도 배워두시면 수익화 하시는데에 많은 도움이 되실거에용
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 621. 삭제는 채널에 영향이 안좋다고 하더라구용 전 처음에 모르고 해봤는데 그 뒤에 영상들도 노출이 안되서 새채널로 다시 시작했었어요 아예 노출이 안되는거라면 괜찮은데 왠만하면 삭제보단 비공개가 낫다고 하더라구용
- count: 1
- room_count: 1
- sources: ops
- example: 삭제는 채널에 영향이 안좋다고 하더라구용 전 처음에 모르고 해봤는데 그 뒤에 영상들도 노출이 안되서 새채널로 다시 시작했었어요 아예 노출이 안되는거라면 괜찮은데 왠만하면 삭제보단 비공개가 낫다고 하더라구용
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 622. 새로 채널파서올린다면 이전에 영상올렸던 그영상들 다시 올려되될까요
- count: 1
- room_count: 1
- sources: ops
- example: 새로 채널파서올린다면, 이전에 영상올렸던 그영상들 다시 올려되될까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 623. 쇼츠 올릴때 배경음악은 쇼츠마다 무조건 다른게 좋나요 하나로 통일해도 상관없나요
- count: 1
- room_count: 1
- sources: ops
- example: 쇼츠 올릴때 배경음악은 쇼츠마다 무조건 다른게 좋나요 하나로 통일해도 상관없나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 624. 쇼츠 처음 시작하는 분들 대부분 조회수 n n인거같은데 이거 당연한거죠 이거 언제까지 버텨야 조회수맛좀 볼까요
- count: 1
- room_count: 1
- sources: ops
- example: 쇼츠 처음 시작하는 분들 대부분 조회수 0~100인거같은데 이거 당연한거죠? 이거 언제까지 버텨야 조회수맛좀 볼까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 625. 시크릿방 자기소개글 남겼는데 쪽지는 언제쯤 발송되나요
- count: 1
- room_count: 1
- sources: ops
- example: 시크릿방 자기소개글 남겼는데 쪽지는 언제쯤 발송되나요?~
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 626. 실수로 방이 나가진거 몰랐다가 다시 들어왔어요 하트는 예전에 체크 하고 인증 샷 올렷는데 다시 올려야 하나요
- count: 1
- room_count: 1
- sources: ops
- example: 실수로 방이 나가진거 몰랐다가 다시 들어왔어요. 하트는 예전에 체크 하고 인증 샷 올렷는데 다시 올려야 하나요?
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 627. 아 어디야 여기
- count: 1
- room_count: 1
- sources: ops
- example: ‘아 어디야 여기’
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 628. 아동도 쓰면 안되고
- count: 1
- room_count: 1
- sources: ops
- example: 아동도 쓰면 안되고..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 629. 아아 그런 방법이 있었군요 넵 감사합니다
- count: 1
- room_count: 1
- sources: ops
- example: 아아 그런 방법이 있었군요. 넵 감사합니다 ㅠㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 630. 아이유랑 닮으면 안되는데
- count: 1
- room_count: 1
- sources: ops
- example: 아이유랑 닮으면 안되는데 ㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 631. 아직 n억 안되서 패스
- count: 1
- room_count: 1
- sources: ops
- example: 아직 1억 안되서 패스
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 632. 아하 개인으로는 안되는구나
- count: 1
- room_count: 1
- sources: ops
- example: 아하 개인으로는.안되는구나..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 633. 악 세대차이 나서 얘기하면 안되겠다
- count: 1
- room_count: 1
- sources: ops
- example: 악 세대차이 나서 얘기하면 안되겠다
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 634. 안녕하세요 맥북 사용자는 다운로드가 안되나요
- count: 1
- room_count: 1
- sources: ops
- example: 안녕하세요 맥북 사용자는 다운로드가 안되나요..??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 635. 안녕하세요 별말로 하트 눌러야하죠
- count: 1
- room_count: 1
- sources: ops
- example: 안녕하세요 별말로 하트 눌러야하죠?
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 636. 안녕하세요 제가 n차 수창신청중에 잇는데 n단계나 n단계 검토중에 영상 비공개해도 상관없나요
- count: 1
- room_count: 1
- sources: ops
- example: 안녕하세요! 제가 1차 수창신청중에 잇는데 2단계나 3단계 검토중에 영상 비공개해도 상관없나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 637. 안녕하세요 혹시 이 강의 다시보기 할 수 있는 방법은 없을까요
- count: 1
- room_count: 1
- sources: ops
- example: 안녕하세요! 혹시 이 강의 다시보기 할 수 있는 방법은 없을까요^^?
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 638. 안돼
- count: 1
- room_count: 1
- sources: ops
- example: 안돼
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 639. 안되던데
- count: 1
- room_count: 1
- sources: ops
- example: 안되던데!!
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 640. 안되죠
- count: 1
- room_count: 1
- sources: ops
- example: 안되죠 ㅋㅋ
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 641. 어디가서 제 강의들엇다고 말하지말라고 하거든요
- count: 1
- room_count: 1
- sources: ops
- example: 어디가서 제 강의들엇다고 말하지말라고 하거든요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 642. 어디가찌
- count: 1
- room_count: 1
- sources: ops
- example: 어디가찌..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 643. 어디로 가시게요
- count: 1
- room_count: 1
- sources: ops
- example: 어디로 가시게요 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 644. 어디보자
- count: 1
- room_count: 1
- sources: ops
- example: 어디보자
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 645. 어디서부터 타야하나
- count: 1
- room_count: 1
- sources: ops
- example: 어디서부터 타야하나 ㅎ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 646. 어디요
- count: 1
- room_count: 1
- sources: ops
- example: 어디요!!!!!!!!!!!!!!
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 647. 어떻게 하지요 캡쳐하려면 하트 화면이 사라져 버리는데요
- count: 1
- room_count: 1
- sources: ops
- example: 어떻게 하지요? 캡쳐하려면 하트 화면이 사라져 버리는데요?
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 648. 어제무료영상 후기는 여기에 작성하나요 카페에 올리나요
- count: 1
- room_count: 1
- sources: ops
- example: 어제무료영상 후기는 여기에 작성하나요? 카페에 올리나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 649. 언제 먹게
- count: 1
- room_count: 1
- sources: ops
- example: 언제 먹게 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 650. 언제 몇시에하나요
- count: 1
- room_count: 1
- sources: ops
- example: 언제 몇시에하나요? 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 651. 언제 물래
- count: 1
- room_count: 1
- sources: ops
- example: 언제 물래?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 652. 언제 올린 영상이야 zz
- count: 1
- room_count: 1
- sources: ops
- example: 언제 올린 영상이야 ?zz
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 653. 언제 요양원까지 차리셨슴까
- count: 1
- room_count: 1
- sources: ops
- example: 언제 요양원까지 차리셨슴까
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 654. 언제든
- count: 1
- room_count: 1
- sources: ops
- example: 언제든
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 655. 업로드 한 영상들 다삭제하시나요 용량이 점점 많아져서요
- count: 1
- room_count: 1
- sources: ops
- example: 업로드 한 영상들 다삭제하시나요? 용량이 점점 많아져서요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 656. 엉덩이를 한대 올려따구
- count: 1
- room_count: 1
- sources: ops
- example: 엉덩이를 한대 올려따구 ?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 657. 여보안되믄 내가 지금 사무실가서 해올라햇음
- count: 1
- room_count: 1
- sources: ops
- example: 여보안되믄 내가 지금 사무실가서 해올라햇음 ㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 658. 영상 정보에 이렇게뜨면 저작권문제없나요
- count: 1
- room_count: 1
- sources: ops
- example: 영상 정보에 이렇게뜨면 저작권문제없나요??
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 659. 영상마다 대부분 시청지속시간은 n n퍼까지 나오는데 참여도가 n n퍼 밖에 안되서 그런지 n천쯤부터 심정지 옵니다 이것두
- count: 1
- room_count: 1
- sources: ops
- example: 영상마다 대부분 시청지속시간은 90-110퍼까지 나오는데 참여도가 40-55퍼 밖에 안되서 그런지...2천쯤부터 심정지 옵니다 ㅠ 이것두 ㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 660. 우와 유랑표 지핏 어디서 받을수있나요
- count: 1
- room_count: 1
- sources: ops
- example: 우와 유랑표 지핏 어디서 받을수있나요😲
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 661. 월 천 찍어도 만족안되는 사람두 있을거구
- count: 1
- room_count: 1
- sources: ops
- example: 월 천 찍어도 만족안되는 사람두 있을거구
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 662. 유랑 혹시 미리캔버스에서 이미지 두장을 겹쳐놓고 가운데 경계를 흐리게 처리하는 방법 아실까요 유랑님
- count: 1
- room_count: 1
- sources: ops
- example: @유랑 혹시 미리캔버스에서 이미지 두장을 겹쳐놓고 가운데 경계를 흐리게 처리하는 방법 아실까요?  유랑님 ㅠㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 663. 유랑님 시니어 사연 채널에서도 생성된 인공지능 배우들이 들어가면 그 항목에 체크해야 해요
- count: 1
- room_count: 1
- sources: ops
- example: 유랑님 시니어 사연 채널에서도 생성된 인공지능 배우들이 들어가면 그 항목에 체크해야 해요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 664. 음 그게 언제 얘기에요
- count: 1
- room_count: 1
- sources: ops
- example: 음...그게 언제 얘기에요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 665. 이거보고 들어왔는데요 하트스샷은 뭔가요
- count: 1
- room_count: 1
- sources: ops
- example: 이거보고 들어왔는데요~ 하트스샷은 뭔가요?
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 666. 인포크링크 꾸미는법을 알려줘
- count: 1
- room_count: 1
- sources: ops
- example: ? 인포크링크 꾸미는법을 알려줘
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 667. 자료는 언제주나요
- count: 1
- room_count: 1
- sources: ops
- example: 자료는 언제주나요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 668. 저도 가입한지는 얼마 안 됐고 롱폼으로 수창해서 잘 모르지만 쇼핑쪽이신가요 아니면 양산형이신가용
- count: 1
- room_count: 1
- sources: ops
- example: 저도 가입한지는 얼마 안 됐고 롱폼으로 수창해서 잘 모르지만 쇼핑쪽이신가요 아니면 양산형이신가용?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 669. 저도 애들보면서 n n일에 n 쇼핑쇼츠 부단히 만들어보고 있는데요 업로드 시간이 막 새벽 n n시 되서 중구난방인데 이런것도 조회수에 영향이 클까여 아니면 다음날 예약해놓는것이 나을지 그냥 컨텐츠만 좋으면 무조건 다 씹어멀을 수 있는지 궁금하네요
- count: 1
- room_count: 1
- sources: ops
- example: 저도 애들보면서 1~3일에 1 쇼핑쇼츠 부단히 만들어보고 있는데요 업로드 시간이 막 새벽 3-4시 되서 중구난방인데 이런것도 조회수에 영향이 클까여?😭 아니면 다음날 예약해놓는것이 나을지.. 그냥 컨텐츠만 좋으면 무조건 다 씹어멀을 수 있는지 궁금하네요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 670. 저두 어디 왔나 함 봐야겠네요
- count: 1
- room_count: 1
- sources: ops
- example: 저두 어디 왔나 함 봐야겠네요 

- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 671. 저희 폼 작성한거 이메일 발송은 언제 해주시나요
- count: 1
- room_count: 1
- sources: ops
- example: 저희 폼 작성한거 이메일 발송은 언제 해주시나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 672. 저희 프로그램에는 자막 지우는 기능 없나요
- count: 1
- room_count: 1
- sources: ops
- example: 저희 프로그램에는 자막 지우는 기능 없나요!?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 673. 전 솔직히 카톡에 프로파일에 사진찍고 네이버에서 폼작성하고 이런게 젤어려웟어요 하는일은 컴터로 하눈건데 소셜미디어 이런거 잘안하고 살아서 어디에 뭐가 붙어있는지 찾는게 젤어려웠어요
- count: 1
- room_count: 1
- sources: ops
- example: 전 솔직히 카톡에 프로파일에 사진찍고 네이버에서 폼작성하고, 이런게 젤어려웟어요. 하는일은 컴터로 하눈건데 소셜미디어 이런거 잘안하고 살아서.. 어디에 뭐가 붙어있는지 찾는게 젤어려웠어요.
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 674. 조회수는 어마어마 한데 돈이 안되어서
- count: 1
- room_count: 1
- sources: ops
- example: 조회수는 어마어마 한데 돈이 ㅋㅋ안되어서 ㅠㅠ
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 675. 줌마
- count: 1
- room_count: 1
- sources: ops
- example: 줌마?!
- decision.intent: ignore
- decision.reason: TOO_SHORT

## 676. 질문잇어요 캡컷 유료랑 프로랑 가장 큰 차이점이 뭔가요 블프 결제를 싸서 햇눈데 프로가아니고 그냥 유료인거같아요 그냥 유료만 써도 무난한가요 큰 차이가잇으면 업그레이드하고 아님 걍 냅둘까해서요
- count: 1
- room_count: 1
- sources: ops
- example: 질문잇어요. 캡컷 유료랑 프로랑 가장 큰 차이점이 뭔가요?? 블프 결제를 싸서 햇눈데 프로가아니고 그냥 유료인거같아요. 그냥 유료만 써도 무난한가요? 큰(?) 차이가잇으면 업그레이드하고 아님 걍 냅둘까해서요
- decision.intent: payment_help
- decision.reason: KB_SEARCH_PAYMENT

예상 발신(Reply) 템플릿(placeholder):
```
😥 결제/입금 안내는 최신 공지 글 기준으로 확인해 주세요.

1) 아래 링크(최신)에서 결제/입금/채널톡 안내를 확인해 주세요.
2) 결제창/메일 링크가 안 보이면, 안내 글의 ‘대체 경로(채널톡)’도 같이 확인해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 677. 카페에서 다시보기 결제 한후 캡쳐해서 이곳에 올리면 되나요
- count: 1
- room_count: 1
- sources: ops
- example: 카페에서  다시보기 결제 한후  캡쳐해서 이곳에  올리면 되나요
- decision.intent: free_replay_recent_3
- decision.reason: KB_MENU_23_FILTER_REPLAY

예상 발신(Reply) 템플릿(placeholder):
```
😊 최근 무료특강 다시보기(보너스프로그램) 글 3개 링크예요.

1) {t1}
2) {t2}
3) {t3}

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 678. 쿠키작업 백날해도 안되는 계정이 있어요
- count: 1
- room_count: 1
- sources: ops
- example: 쿠키작업 백날해도 안되는 계정이 있어요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 679. 쿼드러플강의 다시듣기로 수강했습니다 열심히 알려주시는강사님보고 많이 배웁니다 n기 언제시작할까요 n대중반인 저도 잘할 수 있을지 모르겠지만 용기내보려합니다
- count: 1
- room_count: 1
- sources: ops
- example: 쿼드러플강의 다시듣기로 수강했습니다  열심히 알려주시는강사님보고 많이 배웁니다 2기 언제시작할까요?  50대중반인 저도 잘할 수 있을지 모르겠지만 용기내보려합니다
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 680. 틱톡 유튜브 같이업로드 해도상관없어
- count: 1
- room_count: 1
- sources: ops
- example: ?틱톡 유튜브 같이업로드 해도상관없어?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 681. 틱톡 프로필에 링크 걸수 있는 기준
- count: 1
- room_count: 1
- sources: ops
- example: ?틱톡 프로필에 링크 걸수 있는 기준
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 682. 틱톡 프로필에 인포크링크 그냥 걸수 있나요
- count: 1
- room_count: 1
- sources: ops
- example: 틱톡 프로필에 인포크링크 그냥 걸수 있나요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 683. 편집잘하면 수입화정지 안되나요
- count: 1
- room_count: 1
- sources: ops
- example: 편집잘하면 수입화정지 안되나요 
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 684. 평소에 n분도 안되는 영상만들다가
- count: 1
- room_count: 1
- sources: ops
- example: 평소에 1분도 안되는 영상만들다가
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 685. 퐁평집은 근데 어디서 나왓어요
- count: 1
- room_count: 1
- sources: ops
- example: 퐁평집은 근데 어디서 나왓어요
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 686. 프롬프트 하단에 없던데 어디에서 확인가능할까요
- count: 1
- room_count: 1
- sources: ops
- example: 프롬프트 하단에 없던데 어디에서 확인가능할까요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 687. 하트를 어디서 어떻게 하는지 모르겠어요
- count: 1
- room_count: 1
- sources: ops
- example: 하트를 어디서 어떻게 하는지 모르겠어요
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 688. 해외에서는 안되는 거같아서
- count: 1
- room_count: 1
- sources: ops
- example: 해외에서는 안되는...거같아서
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 689. 헉 유튜브 노출이 아얘안되는데
- count: 1
- room_count: 1
- sources: ops
- example: 헉... 유튜브 노출이 아얘안되는데...?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 690. 현명님 근데 틱톡은 팔로우 n명 전까지는 링크 못거는거 아닌가요 일단 영상 먼저 올리는겅가요
- count: 1
- room_count: 1
- sources: ops
- example: 현명님 근데 틱톡은 팔로우 1000명 전까지는 링크 못거는거 아닌가요? 일단 영상 먼저 올리는겅가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 691. 혹시 다된다윤 강사님 후기 파일은 어디로 받는건가요
- count: 1
- room_count: 1
- sources: ops
- example: 혹시 다된다윤 강사님 후기 파일은 어디로 받는건가요?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 692. 혹시 무료특강 후기 쓰는데 후기폼에 인증샷 넣기 있던데 후기폼이 어딨는걸까요
- count: 1
- room_count: 1
- sources: ops
- example: 혹시 무료특강 후기 쓰는데 후기폼에 인증샷 넣기 있던데 후기폼이 어딨는걸까요?ㅠ 
- decision.intent: heart_screenshot_howto
- decision.reason: KB_SEARCH_HEART

예상 발신(Reply) 템플릿(placeholder):
```
😊 하트 인증샷 업로드 방법을 정리해드릴게요.

1) 하트 화면을 캡쳐해 주세요.
2) 오픈채팅방에 사진으로 업로드해 주세요.

---
🔗 관련 링크
{url1}
{url2}
{url3}
```

## 693. 혹시 유튜브 업로드하는 창이 바뀐거 같은데 저만 그런거 아니죠
- count: 1
- room_count: 1
- sources: ops
- example: 혹시 유튜브 업로드하는 창이 바뀐거 같은데 저만 그런거 아니죠?
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE

## 694. 후 나느 언제 n억되보노
- count: 1
- room_count: 1
- sources: ops
- example: 후..나느 언제 2억되보노..
- decision.intent: ignore
- decision.reason: AMBIGUOUS_OR_NOT_ACTIONABLE
