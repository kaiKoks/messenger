CXX = g++
CXXFLAGS = -Wall -std=c++11 -pthread
LIBS = -lwebsockets -lsqlite3 -lssl -lcrypto

TARGET = server
SRCS = main.cpp

all: $(TARGET)

$(TARGET): $(SRCS)
	$(CXX) $(CXXFLAGS) -o $(TARGET) $(SRCS) $(LIBS)

clean:
	rm -f $(TARGET)

run: $(TARGET)
	./$(TARGET)