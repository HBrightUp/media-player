#include<iostream>

#include <vector>
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
        case media::MsgType::REQEST_MUSIC_LIST: {
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

bool CMsgProcessor::login(const char* pdata) {
    
    bool is_success = false;
    media::Login login;
    login.ParseFromString(pdata);

    std::cout << "name: " << login.name() << std::endl;
    std::cout << "pwd: " << login.pwd() << std::endl;

    if (login.name() == "hml" && login.pwd() == "123") {
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

