#ifndef DATABASE_H
#define DATABASE_H

#include <string>
#include <vector>
#include <mutex>
#include <sqlite3.h>

class Database {
private:
    sqlite3* db;
    std::mutex dbMutex;
    
public:
    Database();
    bool registerUser(const std::string& username, const std::string& password);
    bool loginUser(const std::string& username, const std::string& password);
    std::vector<std::string> getAllUsers();
    void saveMessage(const std::string& from, const std::string& to, const std::string& msg);
    std::string getDialogJSON(const std::string& user1, const std::string& user2);
    std::string getRecentDialogsJSON(const std::string& currentUser);
    ~Database();
};

extern Database db;

#endif