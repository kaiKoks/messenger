import React, { useRef, useEffect } from "react"
import MessageList from "./MessageList"
import type { Message } from '../types/index';


interface ChatProps {
  selectedUser: string | null
  messages: Message[]
  onlineUsers: string[]
  onSendMessage: (text: string) => void
}

const Chat: React.FC<ChatProps> = ({
  selectedUser,
  messages,
  onlineUsers,
  onSendMessage,
}) => {
  const chatInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selectedUser) {
      setTimeout(() => chatInputRef.current?.focus(), 50)
    }
  }, [selectedUser])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!chatInputRef.current || !selectedUser) return
    const text = chatInputRef.current.value.trim()
    if (!text) return

    onSendMessage(text)
    chatInputRef.current.value = ""
    chatInputRef.current.focus()
  }

  if (!selectedUser) {
    return (
      <div className="welcome-placeholder">
        <div className="placeholder-brand">✉️</div>
        <h2>Выберите, кому хотите написать</h2>
        <p>Используйте вкладки или поиск сверху, чтобы открыть диалог</p>
      </div>
    )
  }

  return (
    <>
      <div className="chat-top-bar">
        <div className="active-interlocutor">
          <div className="avatar-circle-small">👤</div>
          <div>
            <div className="interlocutor-name">{selectedUser}</div>
            <div className="interlocutor-status">
              {onlineUsers.includes(selectedUser) ? "В сети" : "Не в сети (офлайн)"}
            </div>
          </div>
        </div>
      </div>

      <MessageList messages={messages} />

      <form onSubmit={handleSubmit} className="chat-bottom-input">
        <input
          ref={chatInputRef}
          type="text"
          placeholder="Напишите сообщение..."
          className="message-field"
          autoFocus
        />
        <button type="submit" className="message-send-btn">
          Отправить
        </button>
      </form>
    </>
  )
}

export default Chat