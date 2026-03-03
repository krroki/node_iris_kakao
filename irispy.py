
from iris import Bot, ChatContext, IrisLink
import sys

if len(sys.argv) < 2:
    print("Usage: python iris.py 172.30.10.66:3000")
    sys.exit(1)
iris_url = sys.argv[1]
bot = Bot(iris_url)
#bot.iris_url은 정제된 주소(IP:PORT 형식)
kl = IrisLink(bot.iris_url)

#메시지 감지
@bot.on_event("message")
def on_message(chat: ChatContext):
    match chat.message.command:
        case "!hi":
            chat.reply(f"Hello, {chat.sender.name}!")

#입장감지
@bot.on_event("new_member")
def on_newmem(chat: ChatContext):
    #chat.reply(f"Hello {chat.sender.name}")
    pass

#퇴장감지
@bot.on_event("del_member")
def on_delmem(chat: ChatContext):
    #chat.reply(f"Bye {chat.sender.name}")
    pass

@bot.on_event("error")
def on_error(err):
    print(f"{err.event} 이벤트에서 오류가 발생했습니다: {err.exception}")

if __name__ == "__main__":
    bot.run()
