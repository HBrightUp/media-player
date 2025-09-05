#include "uimanage.h"
#include<QDebug>
#include"./msg_assembly.h"


UiManage::UiManage() {
    login_.reset(new Login);
    client_.reset( new TcpClient("47.112.188.195", 8000));


    connect(login_.get(), &Login::login_send_message, this, &UiManage::login_message_rev);
    connect(client_.get(), &TcpClient::login_success, this, &UiManage::login_success_rev);
    connect(client_.get(), &TcpClient::play_online_random_response, this, &UiManage::play_online_random_response_recv);
    connect(client_.get(), &TcpClient::download_single_music_response, this, &UiManage::download_single_music_response_recv);

}

UiManage::~UiManage() {
    qInfo() << "UiManage destructor.";
}

void UiManage::start(){

    login_.get()->show();
}

void UiManage::login_message_rev(const std::string& msg){

    client_->writeData(msg);
}

void UiManage::login_success_rev(){
    userName_ = login_.get()->get_user_name();
    qInfo() << "receive login success.";
    login_.reset();
    player_.reset(new Player);

    qInfo()<<"init player singals.";
    connect(player_.get(), &Player::play_online_random, this, &UiManage::play_online_random_recv);
    connect(player_.get(), &Player::download_single_music, this, &UiManage::download_single_music_recv);
    connect(player_.get(), &Player::player_close_event, this, &UiManage::player_exit);

     qInfo()<<"show player.";
    player_.get()->show();
}

void  UiManage::play_online_random_recv() {

    qInfo() << "received play online random.";

    media::PlayOnlineRandom online;
    online.set_username(userName_.toStdString());

    std::string serialized;
    online.SerializeToString(&serialized);

    CMsgAssembly ass;
    std::string msgdata = ass.assembly(media::MsgType::ENU_PLAY_ONLINE_RANDOM, serialized);

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
    std::string msgdata = ass.assembly(media::MsgType::ENU_DOWNLOAD_SINGLE_MUSIC, serialized);

    qInfo() << "send message of download single music to server, size: " << msgdata.size();
    client_->writeData(msgdata);
}

void UiManage::download_single_music_response_recv() {
    player_.get()->on_download_single_music_finished();
}

void UiManage::player_exit() {
    client_.get()->player_exit();
}
