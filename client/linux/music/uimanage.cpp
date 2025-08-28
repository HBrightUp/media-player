#include "uimanage.h"
#include<QDebug>

UiManage::UiManage() {
    login_.reset(new Login);
    client_.reset( new TcpClient("0.0.0.0", 1234));

    connect(login_.get(), &Login::login_send_message, this, &UiManage::login_message_rev);
    connect(client_.get(), &TcpClient::login_success, this, &UiManage::login_success_rev);

}

void UiManage::start(){

    login_.get()->show();
}

void UiManage::login_message_rev(SignalsType signal_id, const std::string& buf){
    qInfo() << "msg id: " << signal_id;
    // login_.reset();
    // player_.reset(new Player);

    // connect(player_.get(), &Player::send_message, this, &UiManage::player_message_rev);
    // player_.get()->show();

    qInfo() << "send login msg.";
    client_->writeData(buf);
}

void UiManage::login_success_rev(){
    qInfo() << "receive login success.";
    login_.reset();
    player_.reset(new Player);
    //connect(player_.get(), &Player::send_message, this, &UiManage::player_message_rev);
    player_.get()->show();
}


// void UiManage::player_message_rev(MessageType msg_id, QString data) {
//     qInfo() << msg_id << data;
//     player_.get()->hide();

//     video_.reset(new Video);
//     //connect(video_.get(), &Video::send_message, this, &UiManage::player_message_rev);

//     video_->show();
// }
