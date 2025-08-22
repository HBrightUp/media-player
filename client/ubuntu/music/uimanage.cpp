#include "uimanage.h"
#include<QDebug>

UiManage::UiManage() {
    login_.reset(new Login);

    connect(login_.get(), &Login::login_send_message, this, &UiManage::login_message_rev);

}

void UiManage::start(){

    login_.get()->show();
}

void UiManage::login_message_rev(int msg_id, QString data){
    qInfo() << msg_id << data;
    login_.reset();

    player_.reset(new Player);
    connect(player_.get(), &Player::send_message, this, &UiManage::player_message_rev);

    player_.get()->show();

}
void UiManage::player_message_rev(int msg_id, QString data) {
    qInfo() << msg_id << data;
    player_.get()->hide();

    video_.reset(new Video);
    //connect(video_.get(), &Video::send_message, this, &UiManage::player_message_rev);

    video_->show();
}
