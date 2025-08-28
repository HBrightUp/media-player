#ifndef LOGIN_H
#define LOGIN_H

#include <QDialog>
#include"./msg_assembly.h"
#include"./music.pb.h"
#include"./signals_type.h"

namespace Ui {
class Login;
}

class Login : public QDialog
{
    Q_OBJECT

public:
    explicit Login(QWidget *parent = nullptr);
    ~Login();

    inline QString get_user_name() { return userName_; }
signals:
    void login_send_message(SignalsType signal, std::string);

private slots:
    void on_btn_login_clicked();



private:
    Ui::Login *ui;
    QPoint winPos_;
    QString userName_;

    // QWidget interface
protected:
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;


};

#endif // LOGIN_H
