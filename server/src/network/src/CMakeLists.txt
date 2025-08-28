
file(GLOB HEADERS "../include/*.h" "../include/*.hpp" )

add_library( network 
    server.cpp 
    event.cpp
    threadpool.cpp
    task.cpp
    msg_process.cpp
    msg_manage.cpp
    ${HEADERS}
)

