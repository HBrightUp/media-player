#include "login.h"
#include "ui_login.h"
#include<QDebug>
#include<QPoint>
#include<QMouseEvent>
#include"./music.pb.h"
#include"./msg_assembly.h"


Login::Login(QWidget *parent)
    : QDialog(parent)
    , ui(new Ui::Login)
{
    ui->setupUi(this);

    setWindowFlag(Qt::FramelessWindowHint); // no frame set and the window cannot be moved ever.
    //setAttribute(Qt::WA_TranslucentBackground);

    // media::Login login;

    // login.set_name("hml");
    // login.set_pwd("123456");
    // login.set_age(20);

    // std::string serialized_string;
    // login.SerializeToString(&serialized_string);

    // CMsgAssembly ass;
    // std::string send_data = ass.assembly(MessageType::LOGIN, serialized_string);


}

Login::~Login()
{
    qInfo() << "login destructor." ;
    delete ui;

}

void Login::on_btn_login_clicked()
{
    // QString name = ui->le_name->text();
    // QString pwd = ui->le_password->text();

    media::Login login;
    userName_ = ui->le_name->text();
    login.set_username(userName_.toStdString().c_str());
    login.set_pwd(ui->le_password->text().toStdString().c_str());

    std::string serialized;
    login.SerializeToString(&serialized);

    CMsgAssembly ass;
    std::string msg = ass.assembly(media::MsgType::ENU_LOGIN, serialized);

    emit login_send_message(msg);

}

void Login::mousePressEvent(QMouseEvent *event) {

}
void Login::mouseMoveEvent(QMouseEvent *event) {

}

void Login::mouseReleaseEvent(QMouseEvent *event)  {

}

