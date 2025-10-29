import { DeleteMemberController, Logger } from "@tsuki-chat/node-iris";

@DeleteMemberController
class CustomDeleteMemberController {
  private logger: Logger;

  constructor() {
    this.logger = new Logger(CustomDeleteMemberController.name);
  }

  // @Command
  // async onDeleteMember(context: ChatContext) {
  //   const userName = await context.sender.getName();
  //   this.logger.info(
  //     `${userName}님이 [${context.room.name}] 채팅방을 떠났습니다.`
  //   );

  //   await context.reply(`${userName}님이 채팅방을 나가셨습니다.`);
  // }
}

export default CustomDeleteMemberController;
