import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './App';
import Assistant from './Assistant';

// "main" is the normal app; "assistant" is rendered by AssistantActivity when the system assistant gesture fires.
AppRegistry.registerComponent('assistant', () => Assistant);
registerRootComponent(App);
