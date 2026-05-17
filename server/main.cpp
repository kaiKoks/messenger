#include <iostream>
#include <string>
#include <map>
#include <vector>
#include <mutex>
#include <signal.h>
#include <libwebsockets.h>
#include <sqlite3.h>
#include <ctime>
#include <fstream>
#include <cstring>
#include <atomic>

// ========== Логирование ==========
class Logger {
private:
    std::ofstream logFile;
    std::mutex logMutex;
    
public:
    Logger() {
        system("mkdir -p ../logs");
        logFile.open("../logs/server.log", std::ios::app);
    }
    
    void log(const std::string& level, const std::string& message) {
        std::lock_guard<std::mutex> lock(logMutex);
        time_t now = time(nullptr);
        char timestamp[64];
        strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", localtime(&now));
        
        std::string formatted = std::string(timestamp) + " [" + level + "] " + message;
        
        if (logFile.is_open()) {
            logFile << formatted << std::endl;
            logFile.flush();
        }
        std::cout << formatted << std::endl;
    }
    
    ~Logger() {
        if (logFile.is_open()) logFile.close();
    }
};

Logger logger;

// ========== База данных ==========
class Database {
private:
    sqlite3* db;
    std::mutex dbMutex;
    
public:
    Database() {
        sqlite3_open("../messages.db", &db);
        const char* createTable = 
            "CREATE TABLE IF NOT EXISTS messages ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "from_user TEXT NOT NULL,"
            "to_user TEXT NOT NULL,"
            "message TEXT NOT NULL,"
            "timestamp INTEGER NOT NULL"
            ");";
        char* errMsg = nullptr;
        sqlite3_exec(db, createTable, nullptr, nullptr, &errMsg);
        if (errMsg) {
            logger.log("DB", "Error: " + std::string(errMsg));
            sqlite3_free(errMsg);
        } else {
            logger.log("DB", "Database initialized");
        }
    }
    
    void saveMessage(const std::string& from, const std::string& to, const std::string& msg) {
        std::lock_guard<std::mutex> lock(dbMutex);
        
        std::string escapedMsg = msg;
        size_t pos = 0;
        while ((pos = escapedMsg.find("'", pos)) != std::string::npos) {
            escapedMsg.replace(pos, 1, "''");
            pos += 2;
        }
        
        std::string sql = "INSERT INTO messages (from_user, to_user, message, timestamp) VALUES ('" +
                         from + "', '" + to + "', '" + escapedMsg + "', " + 
                         std::to_string(time(nullptr)) + ");";
        
        char* errMsg = nullptr;
        sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &errMsg);
        if (errMsg) {
            logger.log("DB", "Failed to save: " + std::string(errMsg));
            sqlite3_free(errMsg);
        }
    }
    
    std::string getHistory(const std::string& user) {
        std::lock_guard<std::mutex> lock(dbMutex);
        std::string history;
        std::string sql = "SELECT from_user, message FROM messages "
                         "WHERE from_user='" + user + "' OR to_user='" + user + "' "
                         "ORDER BY timestamp DESC LIMIT 50;";
        
        sqlite3_stmt* stmt;
        sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);
        
        std::vector<std::string> messages;
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            std::string from = (const char*)sqlite3_column_text(stmt, 0);
            std::string msg = (const char*)sqlite3_column_text(stmt, 1);
            messages.push_back(from + ": " + msg);
        }
        sqlite3_finalize(stmt);
        
        for (auto it = messages.rbegin(); it != messages.rend(); ++it) {
            history += *it + "\n";
        }
        
        return history;
    }
    
    ~Database() {
        sqlite3_close(db);
    }
};

Database db;

// ========== Клиентская структура ==========
struct PerSessionData {
    std::string username;
    bool registered;
    time_t lastActivity;
};

std::map<struct lws*, PerSessionData> clients;
std::map<std::string, struct lws*> userToWsi;
std::mutex clientsMutex;
std::atomic<bool> serverRunning{true};

// ========== Отправка сообщения ==========
void send_message(struct lws* wsi, const std::string& message) {
    if (!wsi) return;
    
    unsigned char* buf = new unsigned char[LWS_SEND_BUFFER_PRE_PADDING + message.length() + LWS_SEND_BUFFER_POST_PADDING];
    unsigned char* p = buf + LWS_SEND_BUFFER_PRE_PADDING;
    memcpy(p, message.c_str(), message.length());
    int result = lws_write(wsi, p, message.length(), LWS_WRITE_TEXT);
    delete[] buf;
    
    if (result < 0) {
        logger.log("ERROR", "Failed to send message");
    }
}

// ========== Рассылка списка пользователей ==========
void broadcastUserList() {
    std::lock_guard<std::mutex> lock(clientsMutex);
    
    std::string userList = "USERS:";
    for (auto& pair : userToWsi) {
        userList += pair.first + ",";
    }
    if (userList.back() == ',') userList.pop_back();
    userList += "\n";
    
    for (auto& pair : clients) {
        if (pair.second.registered) {
            send_message(pair.first, userList);
        }
    }
}

// ========== Отправка списка конкретному клиенту ==========
void sendUserList(struct lws* wsi, const std::string& currentUser) {
    std::string list = "USERS:";
    std::lock_guard<std::mutex> lock(clientsMutex);
    for (auto& pair : userToWsi) {
        if (pair.first != currentUser) {
            list += pair.first + ",";
        }
    }
    if (list.back() == ',') list.pop_back();
    list += "\n";
    send_message(wsi, list);
}

// ========== Обработчик сигналов ==========
void signalHandler(int sig) {
    if (sig == SIGINT || sig == SIGTERM) {
        logger.log("SERVER", "Shutting down...");
        serverRunning = false;
    }
}

// ========== WebSocket колбэк ==========
int callback_messenger(struct lws* wsi, enum lws_callback_reasons reason,
                       void* user, void* in, size_t len) {
    
    PerSessionData* data = (PerSessionData*)user;
    
    switch (reason) {
        case LWS_CALLBACK_PROTOCOL_INIT:
            logger.log("LWS", "Protocol initialized");
            break;
            
        case LWS_CALLBACK_ESTABLISHED: {
            logger.log("CONNECTION", "New client connected");
            // Инициализируем данные сессии
            if (!data) {
                logger.log("ERROR", "No session data, creating");
                // Данные должны быть созданы libwebsockets автоматически
            }
            break;
        }
        
        case LWS_CALLBACK_RECEIVE: {
            if (!in || len == 0) break;
            
            // Проверяем и инициализируем данные
            if (!data) {
                logger.log("ERROR", "No session data, skipping message");
                break;
            }
            
            data->lastActivity = time(nullptr);
            
            std::string message((char*)in, len);
            while (!message.empty() && (message.back() == '\n' || message.back() == '\r')) {
                message.pop_back();
            }
            
            if (message.empty()) break;
            
            logger.log("RECV", message);
            
            // ========== РЕГИСТРАЦИЯ ==========
            if (message.substr(0, 5) == "/reg " || message == "/reg") {
                std::string username = message.length() > 5 ? message.substr(5) : "";
                
                while (!username.empty() && (username.back() == ' ' || username.back() == '\n' || username.back() == '\r')) {
                    username.pop_back();
                }
                
                if (username.empty()) {
                    send_message(wsi, "ERROR: Username cannot be empty\n");
                    break;
                }
                
                if (username.length() > 20) {
                    send_message(wsi, "ERROR: Username too long (max 20 chars)\n");
                    break;
                }
                
                bool success = false;
                {
                    std::lock_guard<std::mutex> lock(clientsMutex);
                    if (userToWsi.find(username) == userToWsi.end()) {
                        // Если был зарегистрирован ранее с другим именем
                        if (!data->username.empty() && data->registered) {
                            userToWsi.erase(data->username);
                        }
                        data->username = username;
                        data->registered = true;
                        userToWsi[username] = wsi;
                        success = true;
                    }
                }
                
                if (success) {
                    logger.log("AUTH", "User '" + username + "' registered");
                    send_message(wsi, "Welcome " + username + "!\n");
                    
                    // Отправляем историю
                    std::string history = db.getHistory(username);
                    if (!history.empty()) {
                        send_message(wsi, "HISTORY:\n" + history);
                    }
                    
                    // Отправляем список пользователей
                    sendUserList(wsi, username);
                    
                    // Рассылаем обновлённый список всем
                    broadcastUserList();
                } else {
                    send_message(wsi, "ERROR: Username already taken\n");
                }
            }
            // ========== ОТПРАВКА СООБЩЕНИЯ ==========
            else if (message.substr(0, 5) == "/msg " && data->registered) {
                std::string rest = message.substr(5);
                size_t space = rest.find(' ');
                
                if (space == std::string::npos) {
                    send_message(wsi, "ERROR: Usage: /msg <user> <message>\n");
                    break;
                }
                
                std::string recipient = rest.substr(0, space);
                std::string text = rest.substr(space + 1);
                
                if (recipient.empty() || text.empty()) {
                    send_message(wsi, "ERROR: Usage: /msg <user> <message>\n");
                    break;
                }
                
                logger.log("MSG", data->username + " -> " + recipient + ": " + text);
                
                // Сохраняем в БД
                db.saveMessage(data->username, recipient, text);
                
                // Отправляем получателю
                bool delivered = false;
                {
                    std::lock_guard<std::mutex> lock(clientsMutex);
                    auto it = userToWsi.find(recipient);
                    if (it != userToWsi.end()) {
                        std::string msg = "MSG:" + data->username + ":" + text + "\n";
                        send_message(it->second, msg);
                        delivered = true;
                    }
                }
                
                if (delivered) {
                    send_message(wsi, "✓ Sent to " + recipient + "\n");
                } else {
                    send_message(wsi, "✗ User '" + recipient + "' not online\n");
                }
            }
            // ========== СПИСОК ПОЛЬЗОВАТЕЛЕЙ ==========
            else if (message == "/users" && data->registered) {
                sendUserList(wsi, data->username);
            }
            // ========== ИСТОРИЯ ==========
            else if (message == "/history" && data->registered) {
                std::string history = db.getHistory(data->username);
                if (history.empty()) {
                    send_message(wsi, "No messages yet\n");
                } else {
                    send_message(wsi, "HISTORY:\n" + history);
                }
            }
            // ========== ПОМОЩЬ ==========
            else if (message == "/help") {
                send_message(wsi, 
                    "Commands:\n"
                    "  /reg <name>  - Register\n"
                    "  /msg <user> <text> - Send message\n"
                    "  /users       - List online users\n"
                    "  /history     - Your message history\n"
                    "  /quit        - Disconnect\n"
                    "  /help        - This help\n");
            }
            // ========== ВЫХОД ==========
            else if (message == "/quit") {
                send_message(wsi, "Goodbye!\n");
                return -1;
            }
            else if (!message.empty() && message[0] == '/') {
                send_message(wsi, "Unknown command. Type /help\n");
            }
            
            break;
        }
        
        case LWS_CALLBACK_CLOSED:
        case LWS_CALLBACK_WSI_DESTROY: {
            if (data && data->registered) {
                logger.log("DISCONNECT", "User '" + data->username + "' disconnected");
                {
                    std::lock_guard<std::mutex> lock(clientsMutex);
                    userToWsi.erase(data->username);
                }
                broadcastUserList();
            }
            break;
        }
        
        default:
            break;
    }
    
    return 0;
}

// ========== WebSocket протокол ==========
static struct lws_protocols protocols[] = {
    {
        "messenger",                           // name
        callback_messenger,                    // callback
        sizeof(PerSessionData),                // per_session_data_size
        4096,                                  // rx_buffer_size
        0,                                     // id
        nullptr,                               // user
        0                                      // tx_packet_size
    },
    { nullptr, nullptr, 0, 0, 0, nullptr, 0 }  // terminator
};

// ========== Главная функция ==========
int main() {
    // Настройка сигналов
    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);
    signal(SIGPIPE, SIG_IGN);
    
    logger.log("SERVER", "========================================");
    logger.log("SERVER", "Messenger Server v3.3");
    logger.log("SERVER", "========================================");
    logger.log("SERVER", "Starting on port 8080");
    logger.log("SERVER", "PID: " + std::to_string(getpid()));
    
    struct lws_context_creation_info info;
    memset(&info, 0, sizeof(info));
    
    info.port = 8080;
    info.protocols = protocols;
    info.gid = -1;
    info.uid = -1;
    info.options = 0;
    info.timeout_secs = 5;
    info.max_http_header_pool = 16;
    
    struct lws_context* context = lws_create_context(&info);
    if (!context) {
        logger.log("ERROR", "Failed to create context. Port 8080 might be in use.");
        return 1;
    }
    
    logger.log("SERVER", "Ready. Connect to ws://localhost:8080");
    logger.log("SERVER", "Press Ctrl+C to stop");
    
    // Таймеры для автообновления
    time_t lastUserListBroadcast = time(nullptr);
    
    while (serverRunning) {
        lws_service(context, 50);
        
        time_t now = time(nullptr);
        
        // Автоматическая рассылка списка пользователей каждые 15 секунд
        if (now - lastUserListBroadcast >= 15) {
            broadcastUserList();
            lastUserListBroadcast = now;
        }
    }
    
    logger.log("SERVER", "Cleaning up...");
    lws_context_destroy(context);
    logger.log("SERVER", "Server stopped");
    return 0;
}