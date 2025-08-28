#include<iostream>

#include <vector>
#include<dirent.h>
#include<sys/stat.h>
#include"../include/msg_process.h"
#include"../../msg/protobuf/music.pb.h"



CMsgProcessor::CMsgProcessor() {
    writenLen_ = 0;
}

CMsgProcessor::~CMsgProcessor() {

}

char* CMsgProcessor::getReader() {
    return readbuf;
}

char* CMsgProcessor::getWriter() {
    return writebuf;
}

int CMsgProcessor::getWriteDataLen() {
    return writenLen_;
}

void CMsgProcessor::process() {

    std::string content(readbuf);

    int pos = content.find(':');
    if(pos < 0) {
        return ;
    }

    
    media::MsgType cmd = static_cast<media::MsgType >(content[0] - '0') ;

    std::cout << "content:" << content << ", pos: " << pos << ",cmd: " << cmd <<std::endl;

    switch (cmd){
        case media::MsgType::LOGIN: {
            login(content.c_str() + MSG_HEADER_SIZE);
            break;
        }
        case media::MsgType::PLAY_ONLINE_RANDOM: {
             play_online_random(content.c_str() + MSG_HEADER_SIZE);
            break;
        }
        case media::MsgType::DOWN_ONE_MUSIC: {
            break;
        }
        default: {
             break;
        }
    }



}

bool CMsgProcessor::play_online_random(const char* pdata) {
    bool is_success = false;

    std::string dirPath = "/home/hml/Downloads";
    std::string extension = ".mp3";  

    std::vector<std::string> files = getFilesWithExtension(dirPath, extension);

    media::PlayOnlineRandomRsp rsp;

    for (const auto& file : files) {
        rsp.add_musicname(file);
    }

    std::string rspStr = rsp.SerializeAsString();
 
    if (rspStr.length() <= 0) {
        return false;
    } 

    std::cout << "serialized play online random size: " << rspStr.length() << std::endl;

    std::string cmd = std::to_string(static_cast<int>(media::MsgType::  PLAY_ONLINE_RANDOM_RESPONSE));
    std::string msg = cmd + ":" + rspStr;
    writenLen_ = msg.length();
    memcpy(writebuf, msg.c_str(), writenLen_);
    writebuf[writenLen_] = 0;
    return true;
}

bool CMsgProcessor::hasExtension(const std::string& filename, const std::string& extension) {
    if (filename.length() >= extension.length()) {
        return (0 == filename.compare(filename.length() - extension.length(), extension.length(), extension));
    }
    return false;
}

std::vector<std::string> CMsgProcessor::getFilesWithExtension(const std::string& dirPath, const std::string& extension) {
    std::vector<std::string> files;
    DIR* dir = opendir(dirPath.c_str());

    if (dir == nullptr) {
        std::cerr << "Unable to open directory: " << dirPath << std::endl;
        return files;
    }

    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        std::string filename = entry->d_name;
     
        if (filename == "." || filename == "..") {
            continue;
        }

        std::string fullPath = dirPath + "/" + filename;


        struct stat fileStat;
        if (stat(fullPath.c_str(), &fileStat) == 0) {
       
            if (S_ISREG(fileStat.st_mode) && hasExtension(filename, extension)) {
                files.push_back(filename);
            }
        }
    }

    closedir(dir);
    return files;
}

bool CMsgProcessor::login(const char* pdata) {
    
    bool is_success = false;
    media::Login login;
    login.ParseFromString(pdata);

    std::cout << "name: " << login.username() << std::endl;
    std::cout << "pwd: " << login.pwd() << std::endl;

    if (login.username() == "hml" && login.pwd() == "123") {
        is_success = true;
    }

    std::string cmd = std::to_string(static_cast<int>(media::MsgType::RESPONSE));
    media::Response rsp;
    rsp.set_cmd(media::MsgType::LOGIN);
    rsp.set_code(200);

    std::string serialized_rsp;
    rsp.SerializeToString(&serialized_rsp); 

    std::cout << "serialized_rsp size: " << serialized_rsp.length() << std::endl;

    std::string msg = cmd + ":" + serialized_rsp;
    writenLen_ = msg.length();
    memcpy(writebuf, msg.c_str(), writenLen_);
    writebuf[writenLen_] = 0;

    return is_success;
}



void CMsgProcessor::getRandomList() {
    std::string path = "~/Music";
    std::string extension = ".mp3";
    std::vector<std::string> file_list;

    for (const auto& entry : std::filesystem::directory_iterator(path)) {
        if (entry.is_regular_file() && entry.path().extension() == extension) {
            std::cout << "find file: " << entry.path() << std::endl;
        }
    }
}

