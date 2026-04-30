#include "bindings/bindings.h"

// Forward declaration — implemented in PencilDoubleTap.mm
extern "C" void pencilSetupInit(void);

int main(int argc, char * argv[]) {
	pencilSetupInit();
	ffi::start_app();
	return 0;
}
