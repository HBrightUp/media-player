#include "login.h"
#include "ui_login.h"
#include<QDebug>
#include<QPoint>
#include<QMouseEvent>

Login::Login(QWidget *parent)
    : QDialog(parent)
    , ui(new Ui::Login)
{
    ui->setupUi(this);

    setWindowFlag(Qt::FramelessWindowHint); // no frame set and the window cannot be moved ever.
    //setAttribute(Qt::WA_TranslucentBackground);

}

Login::~Login()
{
    qInfo() << "login destructor." ;
    delete ui;

}

void Login::on_btn_login_clicked()
{
    QString name = ui->le_name->text();
    QString pwd = ui->le_password->text();

    if (name == "hml" && pwd == "123") {
        emit login_send_message(1, name);
    }
}

void Login::mousePressEvent(QMouseEvent *event) {

}
void Login::mouseMoveEvent(QMouseEvent *event) {

}

void Login::mouseReleaseEvent(QMouseEvent *event)  {

}

