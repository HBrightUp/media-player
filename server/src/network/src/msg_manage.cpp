#include"../include/msg_manage.h"


CMsgManage* CMsgManage::getInstance() {

    static CMsgManage manage;

    return &manage;
}

CMsgManage::CMsgManage() {
    
}

CMsgProcessor* CMsgManage::get_or_create_processor(const int& fd) {
    if (msgmap_[fd] == nullptr) {
        std::unique_lock<std::mutex> lock(msgMux_);
        msgmap_[fd] = new CMsgProcessor();
    }

    return msgmap_[fd];
 }

 void CMsgManage::remove_processor(const int& fd) {
    if (msgmap_[fd] != nullptr) {
        std::unique_lock<std::mutex> lock(msgMux_);
        delete msgmap_[fd];
    }
 }
