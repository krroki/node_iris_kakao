import { Logger, NewMemberController } from "@tsuki-chat/node-iris";

@NewMemberController
class CustomNewMemberController {
  private logger: Logger;

  constructor() {
    this.logger = new Logger(CustomNewMemberController.name);
  }

  //   @Command
  //   async onNewMember(context: ChatContext) {
  //     const userName = await context.sender.getName();
  //     console.log(
  //       `${userName}님이 [${context.room.name}] 채팅방에 입장했습니다.`
  //     );

  //     const welcomeMessage = `
  // 환영합니다!

  // 안녕하세요, ${userName}님!
  // 이 채팅방에 오신 것을 환영합니다.

  // >>help 명령어로 사용 가능한 기능을 확인하세요.
  //       `.trim();

  //     await context.reply(welcomeMessage);
  //   }
}

export default CustomNewMemberController;
