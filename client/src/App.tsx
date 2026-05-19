import React, { useState, useEffect, useRef } from "react"
import type {
  LogEntry,
  DialogInfo,
  ServerMessage,
} from "./services/WebSocketService"
import { websocketService } from "./services/WebSocketService"
import Login from "./components/Login"
import MessageList from "./components/MessageList"
import "./App.css"

interface Message {
  id: string
  text: string
  sender: string
  recipient: string
  timestamp: Date
  isOwn: boolean
  isSystem?: boolean
}

interface Dialog {
  username: string
  lastMessage: string
  timestamp: Date
  unread: number
}

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isConnected, setIsConnected] = useState(false)

  const [allUsers, setAllUsers] = useState<string[]>([])
  const [onlineUsers, setOnlineUsers] = useState<string[]>([])
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])

  const [activeTab, setActiveTab] = useState<"recent" | "online" | "all">(
    "recent",
  )
  const [searchUsername, setSearchUsername] = useState("")

  const [sidebarOpen, setSidebarOpen] = useState(false)

  const chatInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    websocketService.onConnectionChange((connected) => {
      setIsConnected(connected)
      if (!connected) {
        setIsAuthenticated(false)
        setCurrentUser(null)
      }
    })

    websocketService.onMessage((serverMsg: ServerMessage) => {
      const newMsg: Message = {
        id: serverMsg.id,
        text: serverMsg.text,
        sender: serverMsg.sender,
        recipient: serverMsg.recipient,
        timestamp: new Date(serverMsg.timestamp),
        isOwn: serverMsg.sender === currentUser,
      }

      if (
        (serverMsg.sender === selectedUser &&
          serverMsg.recipient === currentUser) ||
        (serverMsg.sender === currentUser &&
          serverMsg.recipient === selectedUser)
      ) {
        setMessages((prev) => [...prev, newMsg])
      }

      if (currentUser) {
        websocketService.getRecentDialogs()
      }
    })

    websocketService.onAllUsers((users) => {
      setAllUsers(users)
    })

    websocketService.onOnlineUsers((users) => {
      setOnlineUsers(users)
    })

    websocketService.onDialogHistory((chatWithUser, historyMsgs) => {
      if (chatWithUser === selectedUser) {
        const parsedMessages: Message[] = historyMsgs.map((m) => ({
          id: m.id,
          text: m.text,
          sender: m.sender,
          recipient: m.recipient,
          timestamp: new Date(m.timestamp),
          isOwn: m.sender === currentUser,
        }))
        setMessages(parsedMessages)
      }
    })

    websocketService.onDialogs((recentDialogs) => {
      const activeDialogs: Dialog[] = recentDialogs.map((d) => ({
        username: d.username,
        lastMessage: d.lastMessage,
        timestamp: new Date(),
        unread: 0,
      }))
      setDialogs(activeDialogs)
    })

    websocketService.connect().catch((err) => {
      console.error("WebSocket error:", err)
    })
  }, [currentUser, selectedUser])

  useEffect(() => {
    if (selectedUser && isAuthenticated) {
      setMessages([])
      websocketService.getDialog(selectedUser)
      setTimeout(() => chatInputRef.current?.focus(), 50)
    }
  }, [selectedUser, isAuthenticated])

  useEffect(() => {
    if (isAuthenticated && isConnected) {
      websocketService.getRecentDialogs()
      websocketService.getOnlineUsers()
      websocketService.getAllUsers()

      const interval = setInterval(() => {
        websocketService.getOnlineUsers()
        websocketService.getRecentDialogs()
      }, 4000)

      return () => clearInterval(interval)
    }
  }, [isAuthenticated, isConnected])

  const handleLogin = async (user: string, pass: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const loggedInUser = await websocketService.login(user, pass)
      setCurrentUser(loggedInUser)
      setIsAuthenticated(true)
    } catch (err: any) {
      setError(err.message || "Неверное имя пользователя или пароль")
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (user: string, pass: string) => {
    setIsLoading(true)
    setError(null)
    try {
      await websocketService.register(user, pass)
      const loggedInUser = await websocketService.login(user, pass)
      setCurrentUser(loggedInUser)
      setIsAuthenticated(true)
    } catch (err: any) {
      setError(err.message || "Ошибка регистрации. Имя может быть занято.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendMessage = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!chatInputRef.current || !selectedUser) return
    const text = chatInputRef.current.value.trim()
    if (!text) return

    const localMsg: Message = {
      id: "local-" + Date.now(),
      text: text,
      sender: currentUser || "me",
      recipient: selectedUser,
      timestamp: new Date(),
      isOwn: true,
    }
    setMessages((prev) => [...prev, localMsg])

    websocketService.sendMessage(selectedUser, text)
    chatInputRef.current.value = ""
    chatInputRef.current.focus()
  }

  const handleStartChatByName = (e: React.FormEvent) => {
    e.preventDefault()
    const targetName = searchUsername.trim()
    if (!targetName || targetName === currentUser) return

    setSelectedUser(targetName)
    setSearchUsername("")
  }

  const handleDisconnect = () => {
    websocketService.disconnect()
    setIsAuthenticated(false)
    setCurrentUser(null)
    setSelectedUser(null)
    setMessages([])
  }

  if (!isAuthenticated) {
    return (
      <div className="app-wrapper unauthenticated">
        <Login
          onLogin={handleLogin}
          onRegister={handleRegister}
          error={error}
          isLoading={isLoading}
        />
      </div>
    )
  }

  return (
    <div className="app-container">
      <div className="main-layout">
        <button
          className="menu-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{ display: window.innerWidth <= 480 ? "flex" : "none" }}
        >
          ☰
        </button>
        <div
          className={`menu-overlay ${sidebarOpen ? "open" : ""}`}
          onClick={() => setSidebarOpen(false)}
        />
        {/* Боковая панель */}
        <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          {/* Текущий пользователь */}
          <div className="user-profile">
            <div className="avatar-circle">
              {currentUser?.substring(0, 2).toUpperCase()}
            </div>
            <div className="user-meta">
              <div className="profile-name">{currentUser}</div>
              <div className="profile-status">В сети</div>
            </div>
            <button
              onClick={handleDisconnect}
              className="icon-exit-btn"
              title="Выйти"
            >
              ✕
            </button>
          </div>

          {/* Быстрый поиск по имени */}
          <form onSubmit={handleStartChatByName} className="search-box">
            <input
              type="text"
              placeholder="Найти или создать чат по имени..."
              value={searchUsername}
              onChange={(e) => setSearchUsername(e.target.value)}
              className="search-field"
            />
            <button type="submit" className="search-add-btn">
              +
            </button>
          </form>

          {/* Табы навигации */}
          <div className="tabs-navigation">
            <button
              className={`tab-item ${activeTab === "recent" ? "active" : ""}`}
              onClick={() => setActiveTab("recent")}
            >
              Чаты
            </button>
            <button
              className={`tab-item ${activeTab === "online" ? "active" : ""}`}
              onClick={() => setActiveTab("online")}
            >
              Онлайн ({onlineUsers.filter((u) => u !== currentUser).length})
            </button>
            <button
              className={`tab-item ${activeTab === "all" ? "active" : ""}`}
              onClick={() => setActiveTab("all")}
            >
              Все
            </button>
          </div>

          {/* Списки пользователей */}
          <div className="list-scroller">
            {activeTab === "recent" && (
              <div className="items-stack">
                {dialogs.length === 0 ?
                  <div className="empty-notice">Нет активных диалогов</div>
                : dialogs.map((dialog) => (
                    <div
                      key={dialog.username}
                      className={`contact-card ${selectedUser === dialog.username ? "active" : ""}`}
                      onClick={() => setSelectedUser(dialog.username)}
                    >
                      <div className="avatar-circle-small">💬</div>
                      <div className="contact-details">
                        <div className="contact-title">{dialog.username}</div>
                        <div className="contact-preview">
                          {dialog.lastMessage || "Сообщений нет"}
                        </div>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}

            {activeTab === "online" && (
              <div className="items-stack">
                {onlineUsers.filter((u) => u !== currentUser).length === 0 ?
                  <div className="empty-notice">Никого нет в сети</div>
                : onlineUsers
                    .filter((u) => u !== currentUser)
                    .map((user) => (
                      <div
                        key={user}
                        className={`contact-card ${selectedUser === user ? "active" : ""}`}
                        onClick={() => setSelectedUser(user)}
                      >
                        <span className="indicator-dot online"></span>
                        <span className="contact-title">{user}</span>
                      </div>
                    ))
                }
              </div>
            )}

            {activeTab === "all" && (
              <div className="items-stack">
                {allUsers.filter((u) => u !== currentUser).length === 0 ?
                  <div className="empty-notice">База пользователей пуста</div>
                : allUsers
                    .filter((u) => u !== currentUser)
                    .map((user) => (
                      <div
                        key={user}
                        className={`contact-card ${selectedUser === user ? "active" : ""}`}
                        onClick={() => setSelectedUser(user)}
                      >
                        <span
                          className={`indicator-dot ${onlineUsers.includes(user) ? "online" : "offline"}`}
                        ></span>
                        <span className="contact-title">{user}</span>
                      </div>
                    ))
                }
              </div>
            )}
          </div>
        </div>

        {/* Окно чата */}
        <div className="chat-area">
          {selectedUser ?
            <>
              <div className="chat-top-bar">
                <div className="active-interlocutor">
                  <div className="avatar-circle-small">👤</div>
                  <div>
                    <div className="interlocutor-name">{selectedUser}</div>
                    <div className="interlocutor-status">
                      {onlineUsers.includes(selectedUser) ?
                        "В сети"
                      : "Не в сети (офлайн)"}
                    </div>
                  </div>
                </div>
              </div>

              <MessageList messages={messages} />

              <form onSubmit={handleSendMessage} className="chat-bottom-input">
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
          : <div className="welcome-placeholder">
              <div className="placeholder-brand">✉️</div>
              <h2>Выберите, кому хотите написать</h2>
              <p>Используйте вкладки или поиск сверху, чтобы открыть диалог</p>
            </div>
          }
        </div>
      </div>
    </div>
  )
}

export default App
