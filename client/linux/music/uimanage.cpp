#include "uimanage.h"
#include<QDebug>
#include"./msg_assembly.h"

UiManage::UiManage() {
    login_.reset(new Login);
    client_.reset( new TcpClient("0.0.0.0", 1234));

    connect(login_.get(), &Login::login_send_message, this, &UiManage::login_message_rev);
    connect(client_.get(), &TcpClient::login_success, this, &UiManage::login_success_rev);
    connect(client_.get(), &TcpClient::play_online_random_response, this, &UiManage::play_online_random_response_recv);

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
    userName_ = login_.get()->get_user_name();
    qInfo() << "receive login success.";
    login_.reset();
    player_.reset(new Player);
    connect(player_.get(), &Player::play_online_random, this, &UiManage::play_online_random_recv);
    connect(player_.get(), &Player::download_single_music, this, &UiManage::download_single_music_recv);
    player_.get()->show();
}

void  UiManage::play_online_random_recv() {

    qInfo() << "received play online random.";

    media::PlayOnlineRandom online;
    online.set_username(userName_.toStdString());

    std::string serialized;
    online.SerializeToString(&serialized);

    CMsgAssembly ass;
    std::string msgdata = ass.assembly(media::MsgType::PLAY_ONLINE_RANDOM, serialized);

    qInfo() << "send server data size: " << msgdata.size();
    client_->writeData(msgdata);

}

void UiManage::play_online_random_response_recv(const QVector<std::string>& musicList) {
    player_.get()->update_music_list_from_server(musicList);
}

void UiManage::download_single_music_recv(const QString& musicName) {
    media::DownloadSingleMusic singleMusic;
    singleMusic.set_username(userName_.toStdString());
    singleMusic.set_musicname(musicName.toStdString());

    std::string serialized;
    singleMusic.SerializeToString(&serialized);

    CMsgAssembly ass;
    std::string msgdata = ass.assembly(media::MsgType::DOWNLOAD_SINGLE_MUSIC, serialized);

    qInfo() << "send message of download single music to server, size: " << msgdata.size();
    client_->writeData(msgdata);
}
