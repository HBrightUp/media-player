
file(GLOB HEADERS "../include/*.h" "../include/*.hpp" )

add_library( msgprotobuf 
    music.pb.cc
    ${HEADERS}
)

