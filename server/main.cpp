#include <new>
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
#include <sstream>

// Простая функция для экранирования строк в JSON (замена кавычек и переносов)
std::string escape_json(const std::string &s) {
    std::ostringstream o;
    for (auto c = s.cbegin(); c != s.cend(); ++c) {
        switch (*c) {
        case '"': o << "\\\""; break;
        case '\\': o << "\\\\"; break;
        case '\b': o << "\\b"; break;
        case '\f': o << "\\f"; break;
        case '\n': o << "\\n"; break;
        case '\r': o << "\\r"; break;
        case '\t': o << "\\t"; break;
        default: o << *c; break;
        }
    }
    return o.str();
}

// ========== Логирование ==========
class Logger
{
private:
    std::ofstream logFile;
    std::mutex logMutex;

public:
    Logger()
    {
        system("mkdir -p ../logs");
        logFile.open("../logs/server.log", std::ios::app);
    }

    void log(const std::string &level, const std::string &message)
    {
        std::lock_guard<std::mutex> lock(logMutex);
        time_t now = time(nullptr);
        char timestamp[64];
        strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", localtime(&now));

        std::string formatted = std::string(timestamp) + " [" + level + "] " + message;

        if (logFile.is_open())
        {
            logFile << formatted << std::endl;
            logFile.flush();
        }
        std::cout << formatted << std::endl;
    }

    ~Logger()
    {
        if (logFile.is_open())
            logFile.close();
    }
};

Logger logger;

// ========== База данных ==========
class Database
{
private:
    sqlite3 *db;
    std::mutex dbMutex;

public:
    Database()
    {
        sqlite3_open("../messages.db", &db);

        const char *createUsersTable =
            "CREATE TABLE IF NOT EXISTS users ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "username TEXT UNIQUE NOT NULL,"
            "password TEXT NOT NULL,"
            "created_at INTEGER NOT NULL"
            ");";

        const char *createMessagesTable =
            "CREATE TABLE IF NOT EXISTS messages ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "from_user TEXT NOT NULL,"
            "to_user TEXT NOT NULL,"
            "message TEXT NOT NULL,"
            "timestamp INTEGER NOT NULL"
            ");";

        char *errMsg = nullptr;
        sqlite3_exec(db, createUsersTable, nullptr, nullptr, &errMsg);
        sqlite3_exec(db, createMessagesTable, nullptr, nullptr, &errMsg);

        if (errMsg)
        {
            logger.log("DB", "Error: " + std::string(errMsg));
            sqlite3_free(errMsg);
        }
        else
        {
            logger.log("DB", "Database initialized");
        }
    }

    bool registerUser(const std::string &username, const std::string &password)
    {
        std::lock_guard<std::mutex> lock(dbMutex);

        std::string sql = "INSERT INTO users (username, password, created_at) VALUES ('" +
                          username + "', '" + password + "', " + std::to_string(time(nullptr)) + ");";

        char *errMsg = nullptr;
        int rc = sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &errMsg);

        if (rc != SQLITE_OK)
        {
            if (errMsg) sqlite3_free(errMsg);
            return false;
        }

        logger.log("AUTH", "User registered: " + username);
        return true;
    }

    bool loginUser(const std::string &username, const std::string &password)
    {
        std::lock_guard<std::mutex> lock(dbMutex);

        std::string sql = "SELECT password FROM users WHERE username='" + username + "';";

        sqlite3_stmt *stmt;
        sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);

        bool success = false;
        if (sqlite3_step(stmt) == SQLITE_ROW)
        {
            std::string dbPassword = (const char *)sqlite3_column_text(stmt, 0);
            if (dbPassword == password)
            {
                success = true;
            }
        }
        sqlite3_finalize(stmt);

        logger.log("AUTH", "Login " + std::string(success ? "success" : "failed") + " for " + username);
        return success;
    }

    std::vector<std::string> getAllUsers()
    {
        std::lock_guard<std::mutex> lock(dbMutex);
        std::vector<std::string> users;

        std::string sql = "SELECT username FROM users ORDER BY username;";
        sqlite3_stmt *stmt;
        sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);

        while (sqlite3_step(stmt) == SQLITE_ROW)
        {
            users.push_back((const char *)sqlite3_column_text(stmt, 0));
        }
        sqlite3_finalize(stmt);

        return users;
    }

    void saveMessage(const std::string &from, const std::string &to, const std::string &msg)
    {
        std::lock_guard<std::mutex> lock(dbMutex);

        std::string escapedMsg = msg;
        size_t pos = 0;
        while ((pos = escapedMsg.find("'", pos)) != std::string::npos)
        {
            escapedMsg.replace(pos, 1, "''");
            pos += 2;
        }

        std::string sql = "INSERT INTO messages (from_user, to_user, message, timestamp) VALUES ('" +
                          from + "', '" + to + "', '" + escapedMsg + "', " +
                          std::to_string(time(nullptr)) + ");";

        char *errMsg = nullptr;
        sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &errMsg);
        if (errMsg)
        {
            sqlite3_free(errMsg);
        }
    }

    // Возвращает историю диалога в формате валидного JSON-массива
    std::string getDialogJSON(const std::string &user1, const std::string &user2)
    {
        std::lock_guard<std::mutex> lock(dbMutex);
        std::string json = "[";

        std::string sql = "SELECT id, from_user, to_user, message, timestamp FROM messages "
                          "WHERE (from_user='" + user1 + "' AND to_user='" + user2 + "') "
                          "OR (from_user='" + user2 + "' AND to_user='" + user1 + "') "
                          "ORDER BY timestamp ASC LIMIT 100;";

        sqlite3_stmt *stmt;
        sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);

        bool first = true;
        while (sqlite3_step(stmt) == SQLITE_ROW)
        {
            if (!first) json += ",";
            first = false;

            int id = sqlite3_column_int(stmt, 0);
            std::string from = (const char *)sqlite3_column_text(stmt, 1);
            std::string to = (const char *)sqlite3_column_text(stmt, 2);
            std::string msg = (const char *)sqlite3_column_text(stmt, 3);
            int timestamp = sqlite3_column_int(stmt, 4);

            json += "{";
            json += "\"id\":\"" + std::to_string(id) + "\",";
            json += "\"sender\":\"" + escape_json(from) + "\",";
            json += "\"recipient\":\"" + escape_json(to) + "\",";
            json += "\"text\":\"" + escape_json(msg) + "\",";
            json += "\"timestamp\":" + std::to_string(timestamp) + "000"; // перевод в миллисекунды для JS Date
            json += "}";
        }
        sqlite3_finalize(stmt);
        json += "]";
        return json;
    }

    // Возвращает список недавних диалогов (активных чатов) для вкладки фронтенда
    std::string getRecentDialogsJSON(const std::string &currentUser)
    {
        std::lock_guard<std::mutex> lock(dbMutex);
        std::string json = "[";

        // Получаем последнего собеседника и текст последнего сообщения с ним
        std::string sql = 
            "SELECT chat_user, message FROM ("
            "  SELECT CASE WHEN from_user = '" + currentUser + "' THEN to_user ELSE from_user END AS chat_user, "
            "  message, timestamp, "
            "  ROW_NUMBER() OVER (PARTITION BY CASE WHEN from_user = '" + currentUser + "' THEN to_user ELSE from_user END ORDER BY timestamp DESC) as rn "
            "  FROM messages WHERE from_user = '" + currentUser + "' OR to_user = '" + currentUser + "'"
            ") WHERE rn = 1 ORDER BY timestamp DESC;";

        sqlite3_stmt *stmt;
        sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr);

        bool first = true;
        while (sqlite3_step(stmt) == SQLITE_ROW)
        {
            if (!first) json += ",";
            first = false;

            std::string chat_user = (const char *)sqlite3_column_text(stmt, 0);
            std::string last_msg = (const char *)sqlite3_column_text(stmt, 1);

            json += "{";
            json += "\"username\":\"" + escape_json(chat_user) + "\",";
            json += "\"lastMessage\":\"" + escape_json(last_msg) + "\"";
            json += "}";
        }
        sqlite3_finalize(stmt);
        json += "]";
        return json;
    }

    ~Database()
    {
        sqlite3_close(db);
    }
};

Database db;

// ========== Клиентская структура ==========
struct PerSessionData
{
    bool is_initialized;
    std::string username;
    bool authenticated;
    std::vector<std::string> message_queue;
    std::mutex queue_mutex;
};
std::map<struct lws *, PerSessionData *> clients;
std::map<std::string, struct lws *> userToWsi;
std::mutex clientsMutex;
std::atomic<bool> serverRunning{true};

// ========== Постановка сообщения в очередь (БЕЗ ДЕДЛОКОВ) ==========
void send_message(struct lws *wsi, const std::string &message)
{
    if (!wsi)
        return;

    PerSessionData* session_data = nullptr;

    // Быстро и безопасно извлекаем указатель на сессию
    {
        std::lock_guard<std::mutex> lock(clientsMutex);
        auto it = clients.find(wsi);
        if (it != clients.end())
        {
            session_data = it->second;
        }
    }

    // Пишем в очередь индивидуальной сессии вне глобального clientsMutex
    if (session_data && session_data->is_initialized)
    {
        {
            std::lock_guard<std::mutex> q_lock(session_data->queue_mutex);
            session_data->message_queue.push_back(message + "\n");
        }
        // lws_callback_on_writable вызывается свободно, так как наши мьютексы отпущены
        lws_callback_on_writable(wsi);
    }
}

// Отправка системных уведомлений в JSON формате
void send_json_status(struct lws* wsi, const std::string &type, const std::string &status, const std::string &payload = "") {
    std::string json = "{\"type\":\"" + type + "\",\"status\":\"" + status + "\"";
    if (!payload.empty()) {
        json += ",\"payload\":" + payload;
    }
    json += "}";
    send_message(wsi, json);
}

// ========== WebSocket колбэк ==========
int callback_messenger(struct lws *wsi, enum lws_callback_reasons reason,
                       void *user, void *in, size_t len)
{
    PerSessionData *data = (PerSessionData *)user;

    switch (reason)
    {
    case LWS_CALLBACK_ESTABLISHED:
    {
        logger.log("CONNECTION", "New client connected");
        if (data)
        {
            new (data) PerSessionData();
            data->is_initialized = true;
            data->authenticated = false;
            data->username = "";
            {
                std::lock_guard<std::mutex> lock(clientsMutex);
                clients[wsi] = data;
            }
        }
        send_json_status(wsi, "connection", "connected", "\"Welcome to Messenger\"");
        break;
    }

    case LWS_CALLBACK_SERVER_WRITEABLE:
    {
        if (!data)
            break;

        std::string msg_to_send;
        {
            std::lock_guard<std::mutex> lock(data->queue_mutex);
            if (!data->message_queue.empty())
            {
                msg_to_send = data->message_queue.front();
                data->message_queue.erase(data->message_queue.begin());
            }
        }

        if (!msg_to_send.empty())
        {
            unsigned char *buf = new unsigned char[LWS_SEND_BUFFER_PRE_PADDING + msg_to_send.length() + LWS_SEND_BUFFER_POST_PADDING];
            unsigned char *p = buf + LWS_SEND_BUFFER_PRE_PADDING;
            memcpy(p, msg_to_send.c_str(), msg_to_send.length());

            lws_write(wsi, p, msg_to_send.length(), LWS_WRITE_TEXT);
            delete[] buf;

            {
                std::lock_guard<std::mutex> lock(data->queue_mutex);
                if (!data->message_queue.empty())
                {
                    lws_callback_on_writable(wsi);
                }
            }
        }
        break;
    }

    case LWS_CALLBACK_RECEIVE:
    {
        if (!in || len == 0 || !data)
            break;

        std::string message((char *)in, len);

        // Очистка строки ввода
        while (!message.empty() && (message.back() == '\n' || message.back() == '\r' || message.back() == ' '))
            message.pop_back();
        while (!message.empty() && (message.front() == ' '))
            message.erase(0, 1);

        if (message.empty())
            break;

        logger.log("RECV", message);

        // ========== РЕГИСТРАЦИЯ ==========
        if (message.find("/register") == 0)
        {
            std::string rest = message.substr(9);
            while (!rest.empty() && rest.front() == ' ') rest.erase(0, 1);
            size_t space = rest.find(' ');

            if (space == std::string::npos) {
                send_json_status(wsi, "register", "error", "\"Usage: /register <username> <password>\"");
                break;
            }

            std::string username = rest.substr(0, space);
            std::string password = rest.substr(space + 1);

            if (db.registerUser(username, password)) {
                send_json_status(wsi, "register", "success", "\"" + username + "\"");
            } else {
                send_json_status(wsi, "register", "fail", "\"Username already exists\"");
            }
            break;
        }

        // ========== ВХОД ==========
        if (message.find("/login") == 0)
        {
            std::string rest = message.substr(6);
            while (!rest.empty() && rest.front() == ' ') rest.erase(0, 1);
            size_t space = rest.find(' ');

            if (space == std::string::npos) {
                send_json_status(wsi, "login", "error", "\"Usage: /login <username> <password>\"");
                break;
            }

            std::string username = rest.substr(0, space);
            std::string password = rest.substr(space + 1);

            if (db.loginUser(username, password))
            {
                data->username = username;
                data->authenticated = true;

                {
                    std::lock_guard<std::mutex> lock(clientsMutex);
                    userToWsi[username] = wsi;
                }

                send_json_status(wsi, "login", "success", "\"" + username + "\"");
            }
            else
            {
                send_json_status(wsi, "login", "fail", "\"Invalid credentials\"");
            }
            break;
        }

        if (!data->authenticated)
        {
            send_json_status(wsi, "auth", "error", "\"Please login first\"");
            break;
        }

        // ========== ОТПРАВКА СООБЩЕНИЯ ==========
        if (message.rfind("/msg ", 0) == 0)
        {
            std::string rest = message.substr(5);
            size_t space = rest.find(' ');

            if (space == std::string::npos) {
                send_json_status(wsi, "msg_status", "error", "\"Usage: /msg <user> <message>\"");
                break;
            }

            std::string recipient = rest.substr(0, space);
            std::string text = rest.substr(space + 1);

            logger.log("MSG", data->username + " -> " + recipient + ": " + text);
            db.saveMessage(data->username, recipient, text);

            struct lws* recipient_wsi = nullptr;
            {
                std::lock_guard<std::mutex> lock(clientsMutex);
                auto it = userToWsi.find(recipient);
                if (it != userToWsi.end()) {
                    recipient_wsi = it->second;
                }
            }

            // Формируем JSON сообщения для отправки получателю
            std::string msgJson = "{\"type\":\"message\",\"sender\":\"" + escape_json(data->username) + 
                                  "\",\"recipient\":\"" + escape_json(recipient) + 
                                  "\",\"text\":\"" + escape_json(text) + 
                                  "\",\"timestamp\":" + std::to_string(time(nullptr)) + "000}";

            if (recipient_wsi != nullptr) {
                send_message(recipient_wsi, msgJson);
                send_json_status(wsi, "msg_status", "delivered", "\"" + recipient + "\"");
            } else {
                send_json_status(wsi, "msg_status", "saved_offline", "\"" + recipient + "\"");
            }
            break;
        }

        // ========== СПИСОК ВСЕХ ПОЛЬЗОВАТЕЛЕЙ ==========
        if (message == "/users")
        {
            std::vector<std::string> users = db.getAllUsers();
            std::string payload = "[";
            bool first = true;
            for (const auto& user : users) {
                if (user == data->username) continue;
                if (!first) payload += ",";
                payload += "\"" + escape_json(user) + "\"";
                first = false;
            }
            payload += "]";
            send_json_status(wsi, "all_users", "success", payload);
            break;
        }

        // ========== СПИСОК ОНЛАЙН ==========
        if (message == "/online")
        {
            std::string payload = "[";
            {
                std::lock_guard<std::mutex> lock(clientsMutex);
                bool first = true;
                for (auto &pair : userToWsi) {
                    if (pair.first == data->username) continue;
                    if (!first) payload += ",";
                    payload += "\"" + escape_json(pair.first) + "\"";
                    first = false;
                }
            }
            payload += "]";
            send_json_status(wsi, "online_users", "success", payload);
            break;
        }

        // ========== ИСТОРИЯ КОНКРЕТНОГО ДИАЛОГА ==========
        if (message.rfind("/dialog ", 0) == 0)
        {
            std::string recipient = message.substr(8);
            std::string dialogJSON = db.getDialogJSON(data->username, recipient);
            
            std::string response = "{\"type\":\"dialog_history\",\"recipient\":\"" + escape_json(recipient) + 
                                   "\",\"messages\":" + dialogJSON + "}";
            send_message(wsi, response);
            break;
        }

        // ========== ВЗЯТЬ ВСЕ АКТИВНЫЕ ДИАЛОГИ (НЕОБХОДИМО ДЛЯ ФРОНТА) ==========
        if (message == "/dialogs")
        {
            std::string recentJSON = db.getRecentDialogsJSON(data->username);
            send_json_status(wsi, "dialogs_list", "success", recentJSON);
            break;
        }

        // ========== ВЫХОД ==========
        if (message == "/quit")
        {
            send_json_status(wsi, "exit", "goodbye");
            return -1;
        }
        break;
    }

    case LWS_CALLBACK_CLOSED:
    case LWS_CALLBACK_WSI_DESTROY:
    {
        if (data && data->is_initialized)
        {
            if (data->authenticated && !data->username.empty())
            {
                logger.log("DISCONNECT", "User '" + data->username + "' disconnected");
                {
                    std::lock_guard<std::mutex> lock(clientsMutex);
                    userToWsi.erase(data->username);
                }
            }

            {
                std::lock_guard<std::mutex> lock(clientsMutex);
                clients.erase(wsi);
            }

            data->~PerSessionData();
            data->is_initialized = false;
        }
        break;
    }

    default:
        break;
    }

    return 0;
}

static struct lws_protocols protocols[] = {
    {"messenger", callback_messenger, sizeof(PerSessionData), 4096, 0, nullptr},
    {NULL, NULL, 0, 0, 0, nullptr}};

void signalHandler(int sig)
{
    if (sig == SIGINT || sig == SIGTERM)
    {
        logger.log("SERVER", "Shutting down...");
        serverRunning = false;
    }
}

int main()
{
    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);
    signal(SIGPIPE, SIG_IGN);

    logger.log("SERVER", "========================================");
    logger.log("SERVER", "Messenger Server v5.1 (JSON Engine)");
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

    struct lws_context *context = lws_create_context(&info);
    if (!context)
    {
        logger.log("ERROR", "Failed to create context. Port 8080 might be in use.");
        return 1;
    }

    logger.log("SERVER", "Ready. Connect to ws://localhost:8080");

    while (serverRunning)
    {
        lws_service(context, 100);
    }

    logger.log("SERVER", "Cleaning up...");
    lws_context_destroy(context);
    logger.log("SERVER", "Server stopped");
    return 0;
}