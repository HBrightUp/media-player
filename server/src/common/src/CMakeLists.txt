
file(GLOB HEADERS "../include/*.h" "../include/*.hpp" )

add_library( common 
    common.cpp
    ${HEADERS}
)

